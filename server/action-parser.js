/**
 * 에이전트 응답에서 액션 태그 파싱
 */

export function parseActions(response) {
  const actions = [];

  // 모든 액션 패턴
  const patterns = [
    { type: 'ASK_TEAM', regex: /\[ASK_TEAM\]([\s\S]*?)\[\/ASK_TEAM\]/g },
    { type: 'ASK_USER', regex: /\[ASK_USER\]([\s\S]*?)\[\/ASK_USER\]/g },
    { type: 'ASK_PREV_TEAM', regex: /\[ASK_PREV_TEAM\]([\s\S]*?)\[\/ASK_PREV_TEAM\]/g },
    { type: 'UPDATE_SPEC', regex: /\[UPDATE_SPEC\]([\s\S]*?)\[\/UPDATE_SPEC\]/g },
    { type: 'UPDATE_DESIGN', regex: /\[UPDATE_DESIGN\]([\s\S]*?)\[\/UPDATE_DESIGN\]/g },
    { type: 'PHASE_COMPLETE', regex: /\[PHASE_COMPLETE\]([\s\S]*?)\[\/PHASE_COMPLETE\]/g },
    { type: 'SEND_NEXT_TEAM', regex: /\[SEND_NEXT_TEAM\]([\s\S]*?)\[\/SEND_NEXT_TEAM\]/g },
    { type: 'ROLLBACK', regex: /\[ROLLBACK\]([\s\S]*?)\[\/ROLLBACK\]/g },
    { type: 'TASK_COMPLETE', regex: /\[TASK_COMPLETE\]([\s\S]*?)\[\/TASK_COMPLETE\]/g },
    { type: 'PROGRESS', regex: /\[PROGRESS\]([\s\S]*?)\[\/PROGRESS\]/g },
    { type: 'BUG_REPORT', regex: /\[BUG_REPORT\]([\s\S]*?)\[\/BUG_REPORT\]/g },
    { type: 'REVIEW', regex: /\[REVIEW\]([\s\S]*?)\[\/REVIEW\]/g },
    { type: 'REQUEST_FIX', regex: /\[REQUEST_FIX\]([\s\S]*?)\[\/REQUEST_FIX\]/g },
    { type: 'OPINION', regex: /\[OPINION\]([\s\S]*?)\[\/OPINION\]/g },
    { type: 'QUESTION', regex: /\[QUESTION\]([\s\S]*?)\[\/QUESTION\]/g },
    { type: 'AGREE', regex: /\[AGREE\]([\s\S]*?)\[\/AGREE\]/g },
    { type: 'DISAGREE', regex: /\[DISAGREE\]([\s\S]*?)\[\/DISAGREE\]/g },
    { type: 'ISSUE', regex: /\[ISSUE\]([\s\S]*?)\[\/ISSUE\]/g },
    { type: 'SUGGESTION', regex: /\[SUGGESTION\]([\s\S]*?)\[\/SUGGESTION\]/g },
    { type: 'TEST_RESULT', regex: /\[TEST_RESULT\]([\s\S]*?)\[\/TEST_RESULT\]/g },
  ];

  // WRITE_FILE 특수 처리 (경로 포함)
  const writeFileRegex = /\[WRITE_FILE:([^\]]+)\]([\s\S]*?)\[\/WRITE_FILE\]/g;
  let match;
  while ((match = writeFileRegex.exec(response)) !== null) {
    actions.push({
      type: 'WRITE_FILE',
      path: match[1].trim(),
      content: match[2].trim()
    });
  }

  // 다른 패턴들 처리
  for (const pattern of patterns) {
    const regex = new RegExp(pattern.regex);
    while ((match = regex.exec(response)) !== null) {
      actions.push({
        type: pattern.type,
        content: match[1].trim()
      });
    }
  }

  return actions;
}

/**
 * 응답에서 액션 태그 제거 (순수 메시지만 추출)
 */
export function extractMessage(response) {
  let message = response;

  // 모든 태그 제거
  message = message.replace(/\[[A-Z_]+(?::[^\]]+)?\][\s\S]*?\[\/[A-Z_]+\]/g, '');

  return message.trim();
}
