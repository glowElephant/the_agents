import { Agent } from './agent.js';
import { getRole, MAX_RETRY_COUNT } from './roles.js';
import { parseActions } from './action-parser.js';

/**
 * 팀 클래스
 * - 같은 역할의 에이전트들을 관리
 * - 팀 내 토론 진행
 * - 팀장이 최종 결정
 */
export class Team {
  constructor(roleId, agentCount, workspacePath, io, projectManager) {
    this.roleId = roleId;
    this.role = getRole(roleId);
    this.workspacePath = workspacePath;
    this.io = io;
    this.projectManager = projectManager;

    this.agents = [];
    this.leader = null;
    this.members = [];

    this.discussionHistory = [];
    this.isActive = false;

    // 에이전트 생성
    for (let i = 0; i < agentCount; i++) {
      const isLeader = (i === 0);
      const agent = new Agent(
        `${roleId}-${i + 1}`,
        roleId,
        isLeader,
        workspacePath,
        io
      );

      this.agents.push(agent);

      if (isLeader) {
        this.leader = agent;
      } else {
        this.members.push(agent);
      }
    }
  }

  /**
   * 팀 시작 (모든 에이전트 시작)
   */
  async start() {
    this.log('info', `${this.role.icon} ${this.role.name}팀 시작 (${this.agents.length}명)`);

    for (const agent of this.agents) {
      await agent.start();
    }

    this.isActive = true;
  }

  /**
   * 팀에 작업 전달 (팀장이 받음)
   */
  async receiveTask(message, context = {}) {
    if (!this.isActive) {
      await this.start();
    }

    this.log('info', `팀장이 작업을 받았습니다`);
    this.discussionHistory = [];

    // 팀장에게 작업 전달
    const leaderMessage = this.buildLeaderMessage(message, context);
    const response = await this.leader.send(leaderMessage);

    // 응답 파싱 및 처리
    return await this.processLeaderResponse(response);
  }

  /**
   * 팀장 메시지 구성
   */
  buildLeaderMessage(task, context) {
    let message = '';

    if (context.fromTeam) {
      message += `[${context.fromTeam}팀으로부터 전달받음]\n`;
    }

    if (context.spec) {
      message += `[기획서]\n${context.spec}\n\n`;
    }

    if (context.files) {
      message += `[생성된 파일들]\n${context.files.join(', ')}\n\n`;
    }

    message += `[작업 내용]\n${task}`;

    if (this.members.length > 0) {
      message += `\n\n팀원이 ${this.members.length}명 있습니다. 필요하면 [ASK_TEAM]으로 의견을 물어보세요.`;
    }

    return message;
  }

  /**
   * 팀장 응답 처리
   */
  async processLeaderResponse(response) {
    const actions = parseActions(response);
    this.discussionHistory.push({ from: 'leader', content: response });

    for (const action of actions) {
      switch (action.type) {
        case 'ASK_TEAM':
          // 팀원들에게 질문
          await this.askTeamMembers(action.content);
          // 팀원 응답을 받은 후 팀장에게 다시 전달
          return await this.continueLeaderWork();

        case 'ASK_USER':
          // 사용자에게 질문
          return { action: 'ask_user', question: action.content, team: this.roleId };

        case 'ASK_PREV_TEAM':
          // 이전 팀에게 질문
          return { action: 'ask_prev_team', question: action.content, team: this.roleId };

        case 'PHASE_COMPLETE':
          // 단계 완료
          return { action: 'phase_complete', summary: action.content, team: this.roleId };

        case 'SEND_NEXT_TEAM':
          // 다음 팀에게 전달
          return { action: 'send_next_team', message: action.content, team: this.roleId };

        case 'ROLLBACK':
          // 이전 단계로 롤백
          return { action: 'rollback', reason: action.content, team: this.roleId };

        case 'TASK_COMPLETE':
          // 전체 작업 완료
          return { action: 'task_complete', summary: action.content, team: this.roleId };

        case 'UPDATE_SPEC':
          // 기획서 업데이트
          await this.projectManager.updateSpec(action.content);
          break;

        case 'UPDATE_DESIGN':
          // 디자인 문서 업데이트
          await this.projectManager.updateDesign(action.content);
          break;

        case 'WRITE_FILE':
          // 파일 작성
          await this.projectManager.writeFile(action.path, action.content);
          break;

        case 'PROGRESS':
          this.log('progress', action.content);
          break;

        case 'BUG_REPORT':
          this.log('bug', action.content);
          break;

        case 'REVIEW':
          this.log('review', action.content);
          break;

        case 'REQUEST_FIX':
          return { action: 'request_fix', content: action.content, team: this.roleId };
      }
    }

    // 특별한 액션 없이 끝난 경우, 계속 진행
    return { action: 'continue', response, team: this.roleId };
  }

  /**
   * 팀원들에게 질문
   */
  async askTeamMembers(question) {
    if (this.members.length === 0) {
      return;
    }

    this.log('info', `팀장이 팀원들에게 질문: ${question}`);

    const memberResponses = [];

    for (const member of this.members) {
      const memberMessage = `[팀장 질문]\n${question}\n\n[이전 토론 내용]\n${this.getDiscussionSummary()}\n\n의견을 말씀해주세요.`;

      const response = await member.send(memberMessage);
      memberResponses.push({ agent: member.name, response });

      this.discussionHistory.push({
        from: member.name,
        content: response
      });

      this.log('info', `${member.name} 응답 완료`);
    }

    return memberResponses;
  }

  /**
   * 팀장 작업 계속
   */
  async continueLeaderWork() {
    const discussionSummary = this.getDiscussionSummary();

    const continueMessage = `[팀원들의 응답]\n${discussionSummary}\n\n팀원들의 의견을 참고하여 계속 진행해주세요.`;

    const response = await this.leader.send(continueMessage);
    return await this.processLeaderResponse(response);
  }

  /**
   * 사용자 답변 전달
   */
  async receiveUserAnswer(answer) {
    const message = `[사용자 답변]\n${answer}\n\n이 정보를 바탕으로 계속 진행해주세요.`;
    const response = await this.leader.send(message);
    return await this.processLeaderResponse(response);
  }

  /**
   * 다른 팀 답변 전달
   */
  async receiveTeamAnswer(fromTeam, answer) {
    const message = `[${fromTeam}팀 답변]\n${answer}\n\n이 정보를 바탕으로 계속 진행해주세요.`;
    const response = await this.leader.send(message);
    return await this.processLeaderResponse(response);
  }

  /**
   * 수정 요청 받음 (롤백 후)
   */
  async receiveFixRequest(fromTeam, issue) {
    const message = `[${fromTeam}팀 수정 요청]\n${issue}\n\n이 문제를 해결해주세요.`;
    const response = await this.leader.send(message);
    return await this.processLeaderResponse(response);
  }

  /**
   * 토론 요약
   */
  getDiscussionSummary() {
    return this.discussionHistory
      .map(d => `${d.from}: ${d.content.slice(0, 200)}...`)
      .join('\n\n');
  }

  /**
   * 로그
   */
  log(type, message) {
    this.io.emit('log', {
      team: this.roleId,
      teamName: `${this.role.icon} ${this.role.name}팀`,
      type,
      message,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 종료
   */
  stop() {
    for (const agent of this.agents) {
      agent.stop();
    }
    this.isActive = false;
  }
}
