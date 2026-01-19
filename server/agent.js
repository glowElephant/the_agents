import { ClaudeCliWrapper } from './cli-wrapper.js';
import { getRole } from './roles.js';

/**
 * 범용 에이전트 클래스
 * - 어떤 역할이든 될 수 있음
 * - 팀장/팀원 구분
 */
export class Agent {
  constructor(id, roleId, isLeader, workspacePath, io) {
    this.id = id;
    this.roleId = roleId;
    this.isLeader = isLeader;
    this.workspacePath = workspacePath;
    this.io = io;

    const role = getRole(roleId);
    this.role = role;
    this.name = `${role.icon} ${role.name}${isLeader ? ' (팀장)' : ''} #${id}`;

    this.cli = null;
  }

  /**
   * 에이전트 시작
   */
  async start() {
    this.log('info', `${this.name} 시작 중...`);
    this.updateStatus('starting');

    // 시스템 프롬프트 (팀장/팀원 구분)
    const systemPrompt = this.isLeader
      ? this.role.leaderPrompt
      : this.role.memberPrompt;

    // CLI 래퍼 생성
    this.cli = new ClaudeCliWrapper(this.name, this.workspacePath, {
      permissionMode: this.role.permissions,
      allowedTools: this.role.allowedTools || null
    });

    this.cli.on('output', (data) => {
      this.io.emit('cli_output', { agent: this.id, role: this.roleId, data });
    });

    this.cli.on('error', (err) => {
      this.log('error', err);
    });

    await this.cli.start(systemPrompt);
    this.log('info', `${this.name} 준비 완료`);
    this.updateStatus('ready');
  }

  /**
   * 메시지 전송
   */
  async send(message) {
    if (!this.cli) {
      throw new Error('에이전트가 시작되지 않았습니다');
    }

    this.updateStatus('thinking');
    const response = await this.cli.send(message);
    this.updateStatus('idle');

    return response;
  }

  /**
   * 로그 출력
   */
  log(type, message) {
    this.io.emit('log', {
      agent: this.id,
      role: this.roleId,
      name: this.name,
      type,
      message,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 상태 업데이트
   */
  updateStatus(status) {
    this.io.emit('agent_status', {
      agent: this.id,
      role: this.roleId,
      name: this.name,
      isLeader: this.isLeader,
      status
    });
  }

  /**
   * 종료
   */
  stop() {
    if (this.cli) {
      this.cli.stop();
    }
  }
}
