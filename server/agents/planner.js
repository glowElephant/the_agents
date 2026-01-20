import { ClaudeCliWrapper, parseResponse } from '../cli-wrapper.js';
import fs from 'fs/promises';
import path from 'path';

export class PlannerAgent {
  constructor(projectId, workspacePath, io, eventBus, logger) {
    this.projectId = projectId;
    this.workspacePath = workspacePath;
    this.io = io;
    this.eventBus = eventBus;
    this.logger = logger;
    this.cli = null;
    this.isWaitingForUser = false;
    this.isWaitingForResponse = false;
  }

  async start() {
    this.log('info', '기획 에이전트 시작 중...');
    this.updateStatus('starting');

    // workspace 디렉토리 생성
    await fs.mkdir(path.join(this.workspacePath, 'spec'), { recursive: true });
    await fs.mkdir(path.join(this.workspacePath, 'src'), { recursive: true });

    // 시스템 프롬프트 로드
    let systemPrompt;
    try {
      const promptPath = path.join(process.cwd(), 'prompts', 'planner.md');
      systemPrompt = await fs.readFile(promptPath, 'utf-8');
    } catch (e) {
      systemPrompt = this.getDefaultPrompt();
    }

    // CLI 시작 (기획 에이전트: 파일 편집만 허용)
    this.cli = new ClaudeCliWrapper('planner', this.workspacePath, {
      permissionMode: 'acceptEdits'
    });

    this.cli.on('output', (data) => {
      // 실시간 출력 전송
      this.io.emit('cli_output', { agent: 'planner', data });
    });

    this.cli.on('error', (err) => {
      this.log('error', err);
    });

    this.cli.on('close', () => {
      this.log('info', '기획 에이전트 CLI 종료됨');
      this.updateStatus('stopped');
    });

    await this.cli.start(systemPrompt);
    this.log('info', '기획 에이전트 준비 완료');
    this.updateStatus('ready');
  }

  getDefaultPrompt() {
    return `당신은 기획 에이전트입니다. 사용자의 요구사항을 분석하고 명확한 기획 문서를 작성합니다.

## 액션 형식
응답할 때 반드시 다음 형식을 사용하세요:

1. 사용자에게 질문할 때:
[ASK_USER]
질문 내용
[/ASK_USER]

2. 기획 문서 작성할 때:
[UPDATE_SPEC]
기획 문서 전체 내용 (마크다운)
[/UPDATE_SPEC]

3. 개발 에이전트에게 전달할 때:
[SEND_TO_DEVELOPER]
메시지
[/SEND_TO_DEVELOPER]

4. 개발 에이전트 질문에 답변할 때:
[REPLY_TO_DEVELOPER]
답변
[/REPLY_TO_DEVELOPER]

## 중요
- 애매한 부분은 [ASK_USER]로 질문
- 기획이 완료되면 [UPDATE_SPEC] 후 [SEND_TO_DEVELOPER]
- 한국어로 소통`;
  }

  log(type, message) {
    this.io.emit('log', {
      agent: 'planner',
      type,
      message,
      timestamp: new Date().toISOString()
    });
  }

  updateStatus(status) {
    this.io.emit('agent_status', { agent: 'planner', status });
  }

  // 사용자 요구사항 처리
  async processRequirement(requirement) {
    this.log('info', '요구사항 분석 시작...');
    this.updateStatus('analyzing');

    const message = `새로운 프로젝트 요구사항입니다:

${requirement}

이 요구사항을 분석해주세요.
- 불명확하거나 추가 정보가 필요한 부분이 있으면 [ASK_USER]로 질문하세요.
- 충분히 이해했다면 [UPDATE_SPEC]으로 기획 문서를 작성하고, [SEND_TO_DEVELOPER]로 개발 에이전트에게 전달하세요.`;

    await this.sendAndProcess(message);
  }

  // 사용자 답변 처리
  async processUserAnswer(answer) {
    if (!this.isWaitingForUser) return;

    this.log('info', '사용자 답변 수신');
    this.isWaitingForUser = false;
    this.updateStatus('processing');

    const message = `사용자의 답변입니다:

${answer}

이 정보를 바탕으로 계속 진행해주세요.
- 추가 질문이 필요하면 [ASK_USER]
- 기획 준비가 되었으면 [UPDATE_SPEC] 후 [SEND_TO_DEVELOPER]`;

    await this.sendAndProcess(message);
  }

  // 개발 에이전트 질문 처리
  async processDeveloperQuestion(question) {
    this.log('info', `개발 에이전트 질문: ${question}`);
    this.updateStatus('answering');

    const message = `개발 에이전트가 질문했습니다:

${question}

이 질문에 답변해주세요.
- 직접 답변할 수 있으면 [REPLY_TO_DEVELOPER]
- 사용자 확인이 필요하면 [ASK_USER]로 먼저 확인 후 답변`;

    await this.sendAndProcess(message);
  }

  // CLI에 메시지 전송하고 응답 처리
  async sendAndProcess(message) {
    this.isWaitingForResponse = true;

    try {
      const response = await this.cli.send(message);
      const parsed = parseResponse(response);

      // 일반 메시지 로그
      if (parsed.message) {
        this.log('message', parsed.message);
      }

      // 액션 처리
      await this.handleActions(parsed.actions);

    } catch (error) {
      this.log('error', `에러: ${error.message}`);
      this.updateStatus('error');
    }

    this.isWaitingForResponse = false;
  }

  // 액션 처리
  async handleActions(actions) {
    for (const action of actions) {
      switch (action.type) {
        case 'ASK_USER':
          this.log('question', action.content);
          this.logger.plannerToUser(action.content);
          this.io.emit('user_question', {
            question: action.content,
            from: 'planner'
          });
          this.isWaitingForUser = true;
          this.updateStatus('waiting_user');
          break;

        case 'UPDATE_SPEC':
          await this.updateSpec(action.content);
          break;

        case 'UPDATE_DESIGN':
          await this.updateDesign(action.content);
          break;

        case 'SEND_TO_DEVELOPER':
          this.log('info', `개발 에이전트에게 전달: ${action.content}`);
          this.io.emit('planner_to_developer', {
            message: action.content,
            spec_complete: true
          });
          this.eventBus.emit('planner_to_developer', {
            message: action.content,
            spec_complete: true
          });
          this.updateStatus('waiting_developer');
          break;

        case 'REPLY_TO_DEVELOPER':
          this.log('info', `개발 에이전트에게 답변`);
          this.io.emit('planner_reply', { answer: action.content });
          this.eventBus.emit('planner_reply', { answer: action.content });
          this.updateStatus('idle');
          break;
      }
    }

    if (!this.isWaitingForUser && actions.length === 0) {
      this.updateStatus('idle');
    }
  }

  // 기획 문서 업데이트
  async updateSpec(content) {
    const specPath = path.join(this.workspacePath, 'spec', 'spec.md');
    await fs.writeFile(specPath, content, 'utf-8');
    this.log('info', '기획 문서(spec.md) 업데이트 완료');
    this.io.emit('spec_updated', { content });
  }

  // 디자인 문서 업데이트
  async updateDesign(content) {
    const designPath = path.join(this.workspacePath, 'spec', 'design.md');
    await fs.writeFile(designPath, content, 'utf-8');
    this.log('info', '디자인 문서(design.md) 업데이트 완료');
    this.io.emit('design_updated', { content });
  }

  // 종료
  stop() {
    if (this.cli) {
      this.cli.stop();
    }
  }
}
