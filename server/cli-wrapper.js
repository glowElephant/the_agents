import { spawn, exec } from 'child_process';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Claude CLI 래퍼
 * - 대화 히스토리 수동 관리
 * - -p 옵션으로 비대화형 실행
 */
export class ClaudeCliWrapper extends EventEmitter {
  constructor(name, workDir, options = {}) {
    super();
    this.name = name;
    this.workDir = workDir;
    this.isReady = false;
    this.systemPrompt = null;
    this.conversationHistory = []; // 대화 히스토리 저장
    // 권한 모드: planner는 acceptEdits, developer는 bypassPermissions
    this.permissionMode = options.permissionMode || 'acceptEdits';
    // 허용할 도구들
    this.allowedTools = options.allowedTools || null;
  }

  /**
   * 초기화 (시스템 프롬프트 설정)
   */
  async start(systemPrompt) {
    this.systemPrompt = systemPrompt;
    this.conversationHistory = [];
    this.isReady = true;
    console.log(`[${this.name}] 에이전트 준비 완료`);
    return Promise.resolve();
  }

  /**
   * 메시지 전송하고 응답 대기
   */
  async send(message) {
    if (!this.isReady) {
      throw new Error('CLI가 준비되지 않았습니다');
    }

    console.log(`\n[${this.name}] 메시지 전송 중...`);

    // 히스토리에 현재 메시지 추가
    this.conversationHistory.push({ role: 'user', content: message });

    // 전체 컨텍스트 구성
    let fullMessage = '';

    // 시스템 프롬프트
    if (this.systemPrompt) {
      fullMessage += `[시스템 지시사항]\n${this.systemPrompt}\n\n`;
    }

    // 대화 히스토리 (최근 10개만 유지하여 토큰 절약)
    const recentHistory = this.conversationHistory.slice(-10);
    if (recentHistory.length > 1) {
      fullMessage += `[이전 대화 기록]\n`;
      for (let i = 0; i < recentHistory.length - 1; i++) {
        const h = recentHistory[i];
        fullMessage += `${h.role === 'user' ? '사용자' : '어시스턴트'}: ${h.content}\n\n`;
      }
      fullMessage += `[현재 메시지]\n`;
    }

    fullMessage += message;

    // 임시 파일에 메시지 저장
    const tempFile = path.join(os.tmpdir(), `claude-msg-${Date.now()}.txt`);
    await fs.writeFile(tempFile, fullMessage, 'utf-8');

    // Windows에서는 type, Unix에서는 cat
    const isWindows = process.platform === 'win32';

    // 기본 명령어
    let claudeArgs = `-p --permission-mode ${this.permissionMode}`;

    // 허용 도구 지정
    if (this.allowedTools) {
      claudeArgs += ` --allowedTools "${this.allowedTools}"`;
    }

    const cmd = isWindows
      ? `type "${tempFile}" | claude ${claudeArgs}`
      : `cat "${tempFile}" | claude ${claudeArgs}`;

    return new Promise((resolve, reject) => {
      exec(cmd, {
        cwd: this.workDir,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env }
      }, async (error, stdout, stderr) => {
        // 임시 파일 삭제
        try { await fs.unlink(tempFile); } catch (e) {}

        if (error) {
          console.error(`[${this.name}] 에러:`, stderr || error.message);
          this.emit('error', stderr || error.message);
        }

        // 응답을 히스토리에 추가
        if (stdout) {
          this.conversationHistory.push({ role: 'assistant', content: stdout.trim() });
          this.emit('output', stdout);
        }

        console.log(`[${this.name}] 응답 완료`);
        resolve(stdout.trim());
      });
    });
  }

  /**
   * 종료 (세션 ID 기반이므로 특별히 할 작업 없음)
   */
  stop() {
    this.isReady = false;
  }
}

/**
 * 응답에서 액션 파싱
 */
export function parseResponse(response) {
  const result = {
    message: '',
    actions: []
  };

  let cleanedResponse = response;

  // ASK_USER
  let match;
  const askUserRegex = /\[ASK_USER\]([\s\S]*?)\[\/ASK_USER\]/g;
  while ((match = askUserRegex.exec(response)) !== null) {
    result.actions.push({ type: 'ASK_USER', content: match[1].trim() });
    cleanedResponse = cleanedResponse.replace(match[0], '');
  }

  // UPDATE_SPEC
  const updateSpecRegex = /\[UPDATE_SPEC\]([\s\S]*?)\[\/UPDATE_SPEC\]/g;
  while ((match = updateSpecRegex.exec(response)) !== null) {
    result.actions.push({ type: 'UPDATE_SPEC', content: match[1].trim() });
    cleanedResponse = cleanedResponse.replace(match[0], '');
  }

  // SEND_TO_DEVELOPER
  const sendDevRegex = /\[SEND_TO_DEVELOPER\]([\s\S]*?)\[\/SEND_TO_DEVELOPER\]/g;
  while ((match = sendDevRegex.exec(response)) !== null) {
    result.actions.push({ type: 'SEND_TO_DEVELOPER', content: match[1].trim() });
    cleanedResponse = cleanedResponse.replace(match[0], '');
  }

  // REPLY_TO_DEVELOPER
  const replyDevRegex = /\[REPLY_TO_DEVELOPER\]([\s\S]*?)\[\/REPLY_TO_DEVELOPER\]/g;
  while ((match = replyDevRegex.exec(response)) !== null) {
    result.actions.push({ type: 'REPLY_TO_DEVELOPER', content: match[1].trim() });
    cleanedResponse = cleanedResponse.replace(match[0], '');
  }

  // ASK_PLANNER
  const askPlannerRegex = /\[ASK_PLANNER\]([\s\S]*?)\[\/ASK_PLANNER\]/g;
  while ((match = askPlannerRegex.exec(response)) !== null) {
    result.actions.push({ type: 'ASK_PLANNER', content: match[1].trim() });
    cleanedResponse = cleanedResponse.replace(match[0], '');
  }

  // WRITE_FILE
  const writeFileRegex = /\[WRITE_FILE:([^\]]+)\]([\s\S]*?)\[\/WRITE_FILE\]/g;
  while ((match = writeFileRegex.exec(response)) !== null) {
    result.actions.push({
      type: 'WRITE_FILE',
      path: match[1].trim(),
      content: match[2].trim()
    });
    cleanedResponse = cleanedResponse.replace(match[0], '');
  }

  // PROGRESS
  const progressRegex = /\[PROGRESS\]([\s\S]*?)\[\/PROGRESS\]/g;
  while ((match = progressRegex.exec(response)) !== null) {
    result.actions.push({ type: 'PROGRESS', content: match[1].trim() });
    cleanedResponse = cleanedResponse.replace(match[0], '');
  }

  // TASK_COMPLETE
  const completeRegex = /\[TASK_COMPLETE\]([\s\S]*?)\[\/TASK_COMPLETE\]/g;
  while ((match = completeRegex.exec(response)) !== null) {
    result.actions.push({ type: 'TASK_COMPLETE', content: match[1].trim() });
    cleanedResponse = cleanedResponse.replace(match[0], '');
  }

  result.message = cleanedResponse.trim();
  return result;
}
