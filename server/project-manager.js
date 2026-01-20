import { Team } from './team.js';
import { getRole, getPhaseOrder, MAX_RETRY_COUNT } from './roles.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * 프로젝트 매니저
 * - 팀들의 순차 진행 관리
 * - 팀 간 통신 중계
 * - 롤백 처리
 * - 무한루프 감지
 */
export class ProjectManager {
  constructor(workspacePath, teamConfig, io) {
    this.workspacePath = workspacePath;
    this.teamConfig = teamConfig; // { planner: 2, developer: 3, ... }
    this.io = io;

    this.teams = new Map();
    this.phaseOrder = [];
    this.currentPhaseIndex = 0;
    this.retryCount = new Map(); // 같은 문제 반복 횟수
    this.isRunning = false;
    this.isPaused = false;

    this.spec = '';
    this.design = '';
    this.createdFiles = [];

    this.conversationLog = []; // 전체 대화 기록
  }

  /**
   * 초기화 - 팀 생성
   */
  async initialize() {
    // workspace 폴더 생성
    await fs.mkdir(path.join(this.workspacePath, 'spec'), { recursive: true });
    await fs.mkdir(path.join(this.workspacePath, 'src'), { recursive: true });
    await fs.mkdir(path.join(this.workspacePath, 'logs'), { recursive: true });

    // 설정된 팀만 생성 (인원 > 0)
    const activeRoles = Object.entries(this.teamConfig)
      .filter(([_, count]) => count > 0)
      .map(([roleId, _]) => roleId);

    // phase 순서대로 정렬
    this.phaseOrder = getPhaseOrder().filter(r => activeRoles.includes(r));

    // 팀 생성
    for (const roleId of this.phaseOrder) {
      const count = this.teamConfig[roleId];
      const team = new Team(roleId, count, this.workspacePath, this.io, this);
      this.teams.set(roleId, team);
    }

    this.log('system', `프로젝트 초기화 완료. 팀: ${this.phaseOrder.join(' → ')}`);
  }

  /**
   * 프로젝트 시작
   */
  async start(requirement) {
    this.isRunning = true;
    this.currentPhaseIndex = 0;

    this.log('system', '프로젝트 시작');
    this.logConversation('system', '사용자', requirement);

    // 첫 번째 팀(보통 기획팀)에 요구사항 전달
    await this.runCurrentPhase(requirement);
  }

  /**
   * 현재 단계 실행
   */
  async runCurrentPhase(message, context = {}) {
    if (!this.isRunning || this.isPaused) return;

    const roleId = this.phaseOrder[this.currentPhaseIndex];
    const team = this.teams.get(roleId);

    if (!team) {
      this.log('error', `팀을 찾을 수 없음: ${roleId}`);
      return;
    }

    this.log('system', `=== ${team.role.icon} ${team.role.name}팀 시작 ===`);
    this.io.emit('phase_change', { phase: roleId, index: this.currentPhaseIndex });

    try {
      const result = await team.receiveTask(message, {
        ...context,
        spec: this.spec,
        design: this.design,
        files: this.createdFiles
      });

      await this.handleTeamResult(result);
    } catch (error) {
      this.log('error', `에러: ${error.message}`);
      this.io.emit('error', { message: error.message });
    }
  }

  /**
   * 팀 결과 처리
   */
  async handleTeamResult(result) {
    if (!result) return;

    const team = this.teams.get(result.team);

    switch (result.action) {
      case 'ask_user':
        // 사용자에게 질문
        this.log('question', `${team.role.name}팀이 질문합니다: ${result.question}`);
        this.logConversation(result.team, '사용자에게', result.question);
        this.io.emit('user_question', {
          from: result.team,
          fromName: `${team.role.icon} ${team.role.name}팀`,
          question: result.question
        });
        this.isPaused = true;
        break;

      case 'ask_prev_team':
        // 이전 팀에게 질문
        await this.askPreviousTeam(result.team, result.question);
        break;

      case 'phase_complete':
        // 단계 완료 → 다음 단계로
        this.log('complete', `${team.role.name}팀 완료: ${result.summary}`);
        this.logConversation(result.team, '완료', result.summary);
        this.retryCount.set(result.team, 0); // 리트라이 카운트 초기화
        await this.moveToNextPhase(result.summary);
        break;

      case 'send_next_team':
        // 다음 팀에게 전달
        await this.moveToNextPhase(result.message);
        break;

      case 'rollback':
        // 이전 단계로 롤백
        await this.rollbackToPreviousPhase(result.team, result.reason);
        break;

      case 'request_fix':
        // 수정 요청 (개발팀으로 롤백)
        await this.requestFix(result.team, result.content);
        break;

      case 'task_complete':
        // 전체 작업 완료
        await this.completeProject(result.summary);
        break;

      case 'continue':
        // 계속 진행 (팀 내부에서 처리됨)
        break;
    }
  }

  /**
   * 다음 단계로 이동
   */
  async moveToNextPhase(message) {
    this.currentPhaseIndex++;

    if (this.currentPhaseIndex >= this.phaseOrder.length) {
      // 모든 단계 완료
      await this.completeProject(message);
      return;
    }

    const nextRoleId = this.phaseOrder[this.currentPhaseIndex];
    const currentRoleId = this.phaseOrder[this.currentPhaseIndex - 1];

    this.log('system', `${currentRoleId}팀 → ${nextRoleId}팀 전달`);

    await this.runCurrentPhase(message, { fromTeam: currentRoleId });
  }

  /**
   * 이전 단계로 롤백
   */
  async rollbackToPreviousPhase(fromTeam, reason) {
    // 리트라이 카운트 증가
    const count = (this.retryCount.get(fromTeam) || 0) + 1;
    this.retryCount.set(fromTeam, count);

    this.log('warning', `롤백 요청 (${count}/${MAX_RETRY_COUNT}): ${reason}`);

    if (count >= MAX_RETRY_COUNT) {
      // 최대 반복 횟수 초과 → 사용자 개입 요청
      this.log('error', `같은 문제가 ${MAX_RETRY_COUNT}회 반복됨. 사용자 개입 필요.`);
      this.io.emit('user_intervention_needed', {
        from: fromTeam,
        reason: reason,
        retryCount: count
      });
      this.isPaused = true;
      return;
    }

    // 이전 단계로 이동
    if (this.currentPhaseIndex > 0) {
      this.currentPhaseIndex--;
      const prevRoleId = this.phaseOrder[this.currentPhaseIndex];
      const prevTeam = this.teams.get(prevRoleId);

      this.log('system', `${fromTeam}팀 → ${prevRoleId}팀 롤백`);

      const result = await prevTeam.receiveFixRequest(fromTeam, reason);
      await this.handleTeamResult(result);
    }
  }

  /**
   * 수정 요청 (리뷰/테스트에서 개발로)
   */
  async requestFix(fromTeam, issue) {
    // 개발팀 찾기
    const devIndex = this.phaseOrder.indexOf('developer');
    if (devIndex === -1) return;

    const count = (this.retryCount.get(fromTeam) || 0) + 1;
    this.retryCount.set(fromTeam, count);

    if (count >= MAX_RETRY_COUNT) {
      this.log('error', `수정 요청이 ${MAX_RETRY_COUNT}회 반복됨. 사용자 개입 필요.`);
      this.io.emit('user_intervention_needed', {
        from: fromTeam,
        reason: issue,
        retryCount: count
      });
      this.isPaused = true;
      return;
    }

    this.currentPhaseIndex = devIndex;
    const devTeam = this.teams.get('developer');

    this.log('system', `${fromTeam}팀 → 개발팀 수정 요청`);

    const result = await devTeam.receiveFixRequest(fromTeam, issue);
    await this.handleTeamResult(result);
  }

  /**
   * 이전 팀에게 질문
   */
  async askPreviousTeam(fromTeam, question) {
    const fromIndex = this.phaseOrder.indexOf(fromTeam);
    if (fromIndex <= 0) {
      // 이전 팀 없음 → 사용자에게 질문
      const team = this.teams.get(fromTeam);
      this.io.emit('user_question', {
        from: fromTeam,
        fromName: `${team.role.icon} ${team.role.name}팀`,
        question: question
      });
      this.isPaused = true;
      return;
    }

    const prevRoleId = this.phaseOrder[fromIndex - 1];
    const prevTeam = this.teams.get(prevRoleId);

    this.log('system', `${fromTeam}팀 → ${prevRoleId}팀 질문`);

    const message = `[${fromTeam}팀 질문]\n${question}\n\n답변해주세요.`;
    const result = await prevTeam.receiveTask(message);

    // 답변을 원래 팀에게 전달
    const currentTeam = this.teams.get(fromTeam);
    const nextResult = await currentTeam.receiveTeamAnswer(prevRoleId, result.response || result.summary);

    await this.handleTeamResult(nextResult);
  }

  /**
   * 사용자 답변 처리
   */
  async handleUserAnswer(answer) {
    this.isPaused = false;
    this.logConversation('user', '답변', answer);

    const roleId = this.phaseOrder[this.currentPhaseIndex];
    const team = this.teams.get(roleId);

    const result = await team.receiveUserAnswer(answer);
    await this.handleTeamResult(result);
  }

  /**
   * 사용자 개입 (강제 진행)
   */
  async handleUserIntervention(command, message) {
    this.isPaused = false;
    this.log('system', `사용자 개입: ${command}`);

    switch (command) {
      case 'continue':
        // 현재 상태로 계속 진행
        this.retryCount.clear();
        await this.moveToNextPhase(message || '사용자가 진행을 승인했습니다.');
        break;

      case 'retry':
        // 현재 단계 재시도
        this.retryCount.set(this.phaseOrder[this.currentPhaseIndex], 0);
        await this.runCurrentPhase(message || '다시 시도해주세요.');
        break;

      case 'skip':
        // 현재 단계 건너뛰기
        await this.moveToNextPhase(message || '이 단계는 건너뜁니다.');
        break;

      case 'abort':
        // 프로젝트 중단
        this.stop();
        break;
    }
  }

  /**
   * 프로젝트 완료
   */
  async completeProject(summary) {
    this.isRunning = false;
    this.log('system', `=== 프로젝트 완료 ===\n${summary}`);

    // 대화 기록 저장
    await this.saveConversationLog();

    this.io.emit('task_complete', {
      summary: summary,
      files_created: this.createdFiles
    });
  }

  /**
   * 기획서 업데이트
   */
  async updateSpec(content) {
    this.spec = content;
    const specPath = path.join(this.workspacePath, 'spec', 'spec.md');
    await fs.writeFile(specPath, content, 'utf-8');
    this.io.emit('spec_updated', { content });
    this.log('file', '기획서 업데이트: spec/spec.md');
  }

  /**
   * 디자인 문서 업데이트
   */
  async updateDesign(content) {
    this.design = content;
    const designPath = path.join(this.workspacePath, 'spec', 'design.md');
    await fs.writeFile(designPath, content, 'utf-8');
    this.io.emit('design_updated', { content });
    this.log('file', '디자인 문서 업데이트: spec/design.md');
  }

  /**
   * 파일 작성
   */
  async writeFile(relativePath, content) {
    const fullPath = path.join(this.workspacePath, 'src', relativePath);
    const dir = path.dirname(fullPath);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');

    if (!this.createdFiles.includes(relativePath)) {
      this.createdFiles.push(relativePath);
    }

    this.io.emit('file_created', { path: relativePath });
    this.log('file', `파일 생성: ${relativePath}`);
  }

  /**
   * 로그
   */
  log(type, message) {
    console.log(`[${type}] ${message}`);
    this.io.emit('log', {
      type,
      message,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 대화 기록 추가
   */
  logConversation(from, to, content) {
    this.conversationLog.push({
      time: new Date().toISOString(),
      from,
      to,
      content
    });

    // 실시간으로 대화 전송
    this.io.emit('conversation', {
      from,
      to,
      content,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 대화 기록 저장
   */
  async saveConversationLog() {
    const logPath = path.join(
      this.workspacePath,
      'logs',
      `conversation-${Date.now()}.json`
    );

    await fs.writeFile(logPath, JSON.stringify(this.conversationLog, null, 2), 'utf-8');
    this.log('file', `대화 기록 저장: ${logPath}`);
  }

  /**
   * 중지
   */
  stop() {
    this.isRunning = false;
    this.isPaused = false;

    for (const team of this.teams.values()) {
      team.stop();
    }

    this.log('system', '프로젝트 중지됨');
  }
}
