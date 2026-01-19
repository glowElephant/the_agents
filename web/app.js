// Socket.io 연결
const socket = io();

// DOM 요소
const inputSection = document.getElementById('input-section');
const statusSection = document.getElementById('status-section');
const questionSection = document.getElementById('question-section');
const specSection = document.getElementById('spec-section');
const logSection = document.getElementById('log-section');
const resultSection = document.getElementById('result-section');

const requirementInput = document.getElementById('requirement');
const workPathInput = document.getElementById('work-path');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');

const plannerState = document.getElementById('planner-state');
const developerState = document.getElementById('developer-state');
const plannerCli = document.getElementById('planner-cli');
const developerCli = document.getElementById('developer-cli');

const questionFrom = document.getElementById('question-from');
const questionText = document.getElementById('question-text');
const answerTextarea = document.getElementById('answer-textarea');
const answerBtn = document.getElementById('answer-btn');

const specContent = document.getElementById('spec-content');
const logContainer = document.getElementById('log-container');
const resultContent = document.getElementById('result-content');
const filesList = document.getElementById('files-list');
const summaryBtn = document.getElementById('summary-btn');
const summaryModal = document.getElementById('summary-modal');
const modalClose = document.getElementById('modal-close');
const summaryStats = document.getElementById('summary-stats');
const summaryTimeline = document.getElementById('summary-timeline');
const summaryFile = document.getElementById('summary-file');

// 상태 텍스트 매핑
const statusTexts = {
  'starting': '시작 중...',
  'ready': '준비 완료',
  'idle': '대기 중',
  'analyzing': '분석 중...',
  'thinking': '생각 중...',
  'processing': '처리 중...',
  'waiting_user': '사용자 답변 대기',
  'waiting_developer': '개발 에이전트 대기',
  'waiting_planner': '기획 에이전트 대기',
  'answering': '답변 작성 중...',
  'reading_spec': '기획서 읽는 중...',
  'coding': '코딩 중...',
  'completed': '완료',
  'stopped': '중단됨',
  'error': '에러'
};

// 시작 버튼 클릭
startBtn.addEventListener('click', () => {
  const requirement = requirementInput.value.trim();
  if (!requirement) {
    alert('요구사항을 입력해주세요.');
    return;
  }

  const workPath = workPathInput.value.trim();

  // UI 전환
  startBtn.disabled = true;
  startBtn.textContent = '처리 중...';
  stopBtn.classList.remove('hidden');
  statusSection.classList.remove('hidden');
  logSection.classList.remove('hidden');
  specSection.classList.remove('hidden');

  // CLI 출력 초기화
  plannerCli.textContent = '';
  developerCli.textContent = '';

  // 서버에 프로젝트 시작 요청
  socket.emit('start_project', {
    requirement,
    workPath: workPath || null
  });
});

// 중단 버튼 클릭
stopBtn.addEventListener('click', () => {
  if (confirm('프로젝트를 중단하시겠습니까?')) {
    socket.emit('stop_project');
    resetUI();
  }
});

// 답변 버튼 클릭
answerBtn.addEventListener('click', () => {
  const answer = answerTextarea.value.trim();
  if (!answer) {
    alert('답변을 입력해주세요.');
    return;
  }

  socket.emit('user_answer', { answer });

  // UI 업데이트
  questionSection.classList.add('hidden');
  answerTextarea.value = '';

  addLog('user', 'info', `답변: ${answer}`);
});

// Enter 키로 답변 전송
answerTextarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) {
    answerBtn.click();
  }
});

// 대화 기록 버튼 클릭
summaryBtn.addEventListener('click', () => {
  socket.emit('get_conversation_summary');
});

// 모달 닫기
modalClose.addEventListener('click', () => {
  summaryModal.classList.add('hidden');
});

// 모달 외부 클릭으로 닫기
summaryModal.addEventListener('click', (e) => {
  if (e.target === summaryModal) {
    summaryModal.classList.add('hidden');
  }
});

// UI 초기화
function resetUI() {
  startBtn.disabled = false;
  startBtn.textContent = '시작';
  stopBtn.classList.add('hidden');
  plannerState.textContent = '대기 중';
  developerState.textContent = '대기 중';
  plannerState.className = 'agent-state';
  developerState.className = 'agent-state';
}

// 로그 추가
function addLog(agent, type, message) {
  const entry = document.createElement('div');
  entry.className = `log-entry ${agent} ${type}`;

  const meta = document.createElement('div');
  meta.className = 'log-meta';
  const time = new Date().toLocaleTimeString();
  const agentNames = {
    'planner': '기획',
    'developer': '개발',
    'user': '사용자',
    'system': '시스템'
  };
  meta.textContent = `[${time}] ${agentNames[agent] || agent}`;

  const msg = document.createElement('div');
  msg.className = 'log-message';
  msg.textContent = message;

  entry.appendChild(meta);
  entry.appendChild(msg);
  logContainer.appendChild(entry);

  logContainer.scrollTop = logContainer.scrollHeight;
}

// 상태 업데이트
function updateAgentStatus(agent, status) {
  const stateEl = agent === 'planner' ? plannerState : developerState;
  const text = statusTexts[status] || status;
  stateEl.textContent = text;

  stateEl.classList.remove('active', 'waiting', 'completed', 'error');

  if (['thinking', 'coding', 'analyzing', 'processing', 'answering', 'reading_spec'].includes(status)) {
    stateEl.classList.add('active');
  } else if (status.startsWith('waiting')) {
    stateEl.classList.add('waiting');
  } else if (status === 'completed') {
    stateEl.classList.add('completed');
  } else if (status === 'error') {
    stateEl.classList.add('error');
  }
}

// CLI 출력 추가
function addCliOutput(agent, data) {
  const cliEl = agent === 'planner' ? plannerCli : developerCli;
  cliEl.textContent += data;
  cliEl.scrollTop = cliEl.scrollHeight;
}

// === 소켓 이벤트 핸들러 ===

socket.on('connect', () => {
  console.log('서버 연결됨');
});

socket.on('project_started', (data) => {
  console.log('프로젝트 시작:', data);
  addLog('system', 'info', `프로젝트 시작 - 경로: ${data.workspacePath}`);
});

socket.on('log', (data) => {
  addLog(data.agent, data.type, data.message);
});

socket.on('agent_status', (data) => {
  updateAgentStatus(data.agent, data.status);
});

socket.on('cli_output', (data) => {
  addCliOutput(data.agent, data.data);
});

socket.on('user_question', (data) => {
  questionSection.classList.remove('hidden');
  questionFrom.textContent = data.from === 'planner' ? '기획 에이전트' : '개발 에이전트';
  questionText.textContent = data.question;
  questionSection.scrollIntoView({ behavior: 'smooth' });
  answerTextarea.focus();
});

socket.on('spec_updated', (data) => {
  specContent.innerHTML = '';
  const pre = document.createElement('pre');
  pre.textContent = data.content;
  specContent.appendChild(pre);
});

socket.on('planner_to_developer', (data) => {
  addLog('planner', 'info', `→ 개발 에이전트에게 전달`);
});

socket.on('developer_to_planner', (data) => {
  addLog('developer', 'question', `→ 기획 에이전트에게 질문: ${data.question}`);
});

socket.on('planner_reply', (data) => {
  addLog('planner', 'info', `→ 개발 에이전트에게 답변`);
});

socket.on('progress', (data) => {
  addLog('developer', data.status, data.message);
});

socket.on('file_created', (data) => {
  addLog('developer', 'info', `파일 생성: ${data.path}`);
});

socket.on('task_complete', (data) => {
  resultSection.classList.remove('hidden');
  resultContent.innerHTML = `<p>${data.summary}</p>`;

  if (data.files_created && data.files_created.length > 0) {
    filesList.innerHTML = '<h3>생성된 파일:</h3>';
    data.files_created.forEach(file => {
      const item = document.createElement('div');
      item.className = 'file-item';
      item.textContent = file;
      filesList.appendChild(item);
    });
  }

  startBtn.disabled = false;
  startBtn.textContent = '새 프로젝트 시작';
  stopBtn.classList.add('hidden');
});

socket.on('error', (data) => {
  addLog('system', 'error', `오류: ${data.message}`);
});

socket.on('disconnect', () => {
  console.log('서버 연결 끊김');
  addLog('system', 'error', '서버 연결이 끊겼습니다.');
});

// 대화 기록 요약 수신
socket.on('conversation_summary', (data) => {
  const { summary, filepath } = data;

  // 통계 표시
  summaryStats.innerHTML = `
    <div class="stat-item">
      <div class="stat-value">${summary.totalInteractions}</div>
      <div class="stat-label">총 대화 수</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">${summary.userQuestions}</div>
      <div class="stat-label">사용자 질문</div>
    </div>
    <div class="stat-item">
      <div class="stat-value">${summary.filesCreated.length}</div>
      <div class="stat-label">생성된 파일</div>
    </div>
  `;

  // 타임라인 표시
  summaryTimeline.innerHTML = summary.timeline.map(item => `
    <div class="timeline-item">
      <span class="timeline-time">${item.time}</span>
      ${item.text}
    </div>
  `).join('');

  // 파일 경로 표시
  summaryFile.textContent = `대화 기록 저장됨: ${filepath}`;

  // 모달 표시
  summaryModal.classList.remove('hidden');
});
