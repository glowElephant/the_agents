import { ClaudeCliWrapper, parseResponse } from '../cli-wrapper.js';
import fs from 'fs/promises';
import path from 'path';

export class DeveloperAgent {
  constructor(projectId, workspacePath, io, eventBus, logger) {
    this.projectId = projectId;
    this.workspacePath = workspacePath;
    this.io = io;
    this.eventBus = eventBus;
    this.logger = logger;
    this.cli = null;
    this.isWaitingForPlanner = false;
    this.isWaitingForResponse = false;
  }

  async start() {
    this.log('info', '개발 에이전트 시작 중...');
    this.updateStatus('starting');

    // 시스템 프롬프트 로드
    let systemPrompt;
    try {
      const promptPath = path.join(process.cwd(), 'prompts', 'developer.md');
      systemPrompt = await fs.readFile(promptPath, 'utf-8');
    } catch (e) {
      systemPrompt = this.getDefaultPrompt();
    }

    // CLI 시작 (개발 에이전트: 모든 권한 허용 - 파일 쓰기, bash 등)
    this.cli = new ClaudeCliWrapper('developer', this.workspacePath, {
      permissionMode: 'bypassPermissions',
      allowedTools: 'Bash,Read,Write,Edit,Glob,Grep'
    });

    this.cli.on('output', (data) => {
      // 실시간 출력 전송
      this.io.emit('cli_output', { agent: 'developer', data });
    });

    this.cli.on('error', (err) => {
      this.log('error', err);
    });

    this.cli.on('close', () => {
      this.log('info', '개발 에이전트 CLI 종료됨');
      this.updateStatus('stopped');
    });

    await this.cli.start(systemPrompt);
    this.log('info', '개발 에이전트 준비 완료');
    this.updateStatus('ready');
  }

  getDefaultPrompt() {
    return `당신은 개발 에이전트입니다. 기획 문서를 바탕으로 코드를 작성합니다.

## 액션 형식
응답할 때 반드시 다음 형식을 사용하세요:

1. 기획 에이전트에게 질문:
[ASK_PLANNER]
질문 내용
[/ASK_PLANNER]

2. 파일 작성:
[WRITE_FILE:파일경로]
파일 내용
[/WRITE_FILE]

3. 진행 상황:
[PROGRESS]
메시지
[/PROGRESS]

4. 완료:
[TASK_COMPLETE]
완료 요약
생성된 파일: file1.js, file2.css
[/TASK_COMPLETE]

## 중요
- 불명확하면 [ASK_PLANNER]로 질문
- 파일은 하나씩 [WRITE_FILE:경로]로 작성
- 모두 완료되면 [TASK_COMPLETE]
- 한국어로 소통`;
  }

  log(type, message) {
    this.io.emit('log', {
      agent: 'developer',
      type,
      message,
      timestamp: new Date().toISOString()
    });
  }

  updateStatus(status) {
    this.io.emit('agent_status', { agent: 'developer', status });
  }

  // 개발 시작
  async startDevelopment(plannerMessage) {
    this.log('info', '개발 시작...');
    this.updateStatus('reading_spec');

    // 기획 문서 읽기
    const specPath = path.join(this.workspacePath, 'spec', 'spec.md');
    let specContent = '';
    try {
      specContent = await fs.readFile(specPath, 'utf-8');
    } catch (e) {
      this.log('error', '기획 문서를 찾을 수 없습니다.');
      return;
    }

    const message = `기획 에이전트로부터 작업 지시를 받았습니다.

메시지: ${plannerMessage}

기획 문서:
\`\`\`markdown
${specContent}
\`\`\`

이제 개발을 시작해주세요.
- 불명확한 부분은 [ASK_PLANNER]로 질문
- 파일 작성은 [WRITE_FILE:경로]
- 완료되면 [TASK_COMPLETE]`;

    await this.sendAndProcess(message);
  }

  // 기획자 답변 처리
  async processPlannerAnswer(answer) {
    if (!this.isWaitingForPlanner) return;

    this.log('info', '기획 에이전트 답변 수신');
    this.isWaitingForPlanner = false;
    this.updateStatus('coding');

    const message = `기획 에이전트의 답변입니다:

${answer}

이 정보를 바탕으로 계속 개발해주세요.`;

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
      const needsMore = await this.handleActions(parsed.actions);

      // 파일 작성 후 계속 진행
      if (needsMore) {
        await this.continueWork();
      }

    } catch (error) {
      this.log('error', `에러: ${error.message}`);
      this.updateStatus('error');
    }

    this.isWaitingForResponse = false;
  }

  // 작업 계속
  async continueWork() {
    const message = `계속해서 다음 파일을 작성해주세요.
모든 파일을 완료했으면 [TASK_COMPLETE]를 사용하세요.`;

    await this.sendAndProcess(message);
  }

  // 액션 처리
  async handleActions(actions) {
    let wroteFiles = false;

    for (const action of actions) {
      switch (action.type) {
        case 'ASK_PLANNER':
          this.log('question', `기획 에이전트에게 질문: ${action.content}`);
          this.io.emit('developer_to_planner', { question: action.content });
          this.eventBus.emit('developer_to_planner', { question: action.content });
          this.isWaitingForPlanner = true;
          this.updateStatus('waiting_planner');
          return false; // 응답 대기

        case 'WRITE_FILE':
          await this.writeFile(action.path, action.content);
          this.logger.fileCreated(action.path);
          wroteFiles = true;
          break;

        case 'PROGRESS':
          this.log('in_progress', action.content);
          this.logger.developerProgress(action.content);
          this.io.emit('progress', { status: 'in_progress', message: action.content });
          break;

        case 'TASK_COMPLETE':
          const lines = action.content.split('\n');
          const summary = lines[0];
          const filesLine = lines.find(l => l.includes('생성된 파일:'));
          const files = filesLine
            ? filesLine.replace('생성된 파일:', '').split(',').map(f => f.trim())
            : [];

          this.log('info', `작업 완료: ${summary}`);
          this.logger.taskComplete(summary);
          this.io.emit('task_complete', { summary, files_created: files });
          this.updateStatus('completed');
          return false;
      }
    }

    if (!this.isWaitingForPlanner && !wroteFiles) {
      this.updateStatus('idle');
    }

    return wroteFiles;
  }

  // 파일 작성
  async writeFile(relativePath, content) {
    const fullPath = path.join(this.workspacePath, 'src', relativePath);
    const dir = path.dirname(fullPath);

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');

    this.log('info', `파일 생성: ${relativePath}`);
    this.io.emit('file_created', { path: relativePath, content });
  }

  // 종료
  stop() {
    if (this.cli) {
      this.cli.stop();
    }
  }
}
