import fs from 'fs/promises';
import path from 'path';

/**
 * 대화 기록 관리 클래스
 */
export class ConversationLogger {
  constructor(workspacePath) {
    this.workspacePath = workspacePath;
    this.conversations = [];
  }

  /**
   * 대화 추가
   */
  add(from, to, type, content) {
    this.conversations.push({
      timestamp: new Date().toISOString(),
      from,
      to,
      type,
      content
    });
  }

  /**
   * 사용자 → 기획 에이전트
   */
  userToPlanner(content) {
    this.add('사용자', '기획 에이전트', 'requirement', content);
  }

  /**
   * 기획 에이전트 → 사용자 (질문)
   */
  plannerToUser(question) {
    this.add('기획 에이전트', '사용자', 'question', question);
  }

  /**
   * 사용자 → 기획 에이전트 (답변)
   */
  userAnswer(answer) {
    this.add('사용자', '기획 에이전트', 'answer', answer);
  }

  /**
   * 기획 에이전트 → 개발 에이전트
   */
  plannerToDeveloper(message) {
    this.add('기획 에이전트', '개발 에이전트', 'handoff', message);
  }

  /**
   * 개발 에이전트 → 기획 에이전트 (질문)
   */
  developerToPlanner(question) {
    this.add('개발 에이전트', '기획 에이전트', 'question', question);
  }

  /**
   * 기획 에이전트 → 개발 에이전트 (답변)
   */
  plannerReply(answer) {
    this.add('기획 에이전트', '개발 에이전트', 'answer', answer);
  }

  /**
   * 개발 에이전트 진행 상황
   */
  developerProgress(message) {
    this.add('개발 에이전트', '시스템', 'progress', message);
  }

  /**
   * 파일 생성
   */
  fileCreated(filePath) {
    this.add('개발 에이전트', '시스템', 'file_created', filePath);
  }

  /**
   * 작업 완료
   */
  taskComplete(summary) {
    this.add('개발 에이전트', '시스템', 'complete', summary);
  }

  /**
   * 대화 요약 생성
   */
  generateSummary() {
    const summary = {
      totalInteractions: this.conversations.length,
      userQuestions: 0,
      agentQuestions: 0,
      filesCreated: [],
      timeline: []
    };

    for (const conv of this.conversations) {
      // 타입별 카운트
      if (conv.type === 'question' && conv.from === '기획 에이전트') {
        summary.userQuestions++;
      }
      if (conv.type === 'question' && conv.from === '개발 에이전트') {
        summary.agentQuestions++;
      }
      if (conv.type === 'file_created') {
        summary.filesCreated.push(conv.content);
      }

      // 타임라인 (요약)
      const time = new Date(conv.timestamp).toLocaleTimeString();
      let text = '';

      switch (conv.type) {
        case 'requirement':
          text = `[요구사항] ${this.truncate(conv.content, 100)}`;
          break;
        case 'question':
          text = `[${conv.from} 질문] ${this.truncate(conv.content, 80)}`;
          break;
        case 'answer':
          text = `[${conv.from} 답변] ${this.truncate(conv.content, 80)}`;
          break;
        case 'handoff':
          text = `[기획 완료] 개발 에이전트에게 전달`;
          break;
        case 'progress':
          text = `[진행] ${this.truncate(conv.content, 60)}`;
          break;
        case 'file_created':
          text = `[파일 생성] ${conv.content}`;
          break;
        case 'complete':
          text = `[완료] ${this.truncate(conv.content, 80)}`;
          break;
        default:
          text = `[${conv.type}] ${this.truncate(conv.content, 60)}`;
      }

      summary.timeline.push({ time, text });
    }

    return summary;
  }

  /**
   * 텍스트 자르기
   */
  truncate(text, maxLength) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  /**
   * 전체 기록 텍스트로 변환
   */
  toText() {
    let text = '# 대화 기록\n\n';

    for (const conv of this.conversations) {
      const time = new Date(conv.timestamp).toLocaleString();
      text += `## [${time}] ${conv.from} → ${conv.to}\n`;
      text += `**유형:** ${conv.type}\n\n`;
      text += `${conv.content}\n\n`;
      text += '---\n\n';
    }

    return text;
  }

  /**
   * 파일로 저장
   */
  async saveToFile() {
    const logDir = path.join(this.workspacePath, 'logs');
    await fs.mkdir(logDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `conversation-${timestamp}.md`;
    const filepath = path.join(logDir, filename);

    await fs.writeFile(filepath, this.toText(), 'utf-8');

    return filepath;
  }

  /**
   * 모든 대화 반환
   */
  getAll() {
    return this.conversations;
  }
}
