// Socket.io 연결
const socket = io();

// DOM 요소
const configSection = document.getElementById('config-section');
const progressSection = document.getElementById('progress-section');
const conversationSection = document.getElementById('conversation-section');
const questionSection = document.getElementById('question-section');
const interventionSection = document.getElementById('intervention-section');
const docsSection = document.getElementById('docs-section');
const resultSection = document.getElementById('result-section');

const requirementInput = document.getElementById('requirement');
const workPathInput = document.getElementById('work-path');
const teamConfigDiv = document.getElementById('team-config');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');

const phaseProgress = document.getElementById('phase-progress');
const conversationContainer = document.getElementById('conversation-container');

const questionFrom = document.getElementById('question-from');
const questionText = document.getElementById('question-text');
const answerTextarea = document.getElementById('answer-textarea');
const answerBtn = document.getElementById('answer-btn');

const interventionReason = document.getElementById('intervention-reason');
const retryCountEl = document.getElementById('retry-count');
const interventionMessage = document.getElementById('intervention-message');

const specContent = document.getElementById('spec-content');
const designContent = document.getElementById('design-content');
const resultContent = document.getElementById('result-content');
const filesList = document.getElementById('files-list');

// 역할 목록
let roles = [];
let teamConfig = {};
let activePhases = [];

// 초기화 - 역할 목록 가져오기
socket.on('connect', () => {
  console.log('서버 연결됨');
  socket.emit('get_roles');
});

// 역할 목록 수신
socket.on('roles', (data) => {
  roles = data;
  renderTeamConfig();
});

// 팀 구성 UI 렌더링
function renderTeamConfig() {
  teamConfigDiv.innerHTML = roles.map(role => `
    <div class="role-config">
      <span class="role-icon">${role.icon}</span>
      <span class="role-name">${role.name}</span>
      <select id="role-${role.id}" class="role-count" onchange="updateTeamConfig()">
        <option value="0">0명</option>
        <option value="1" ${role.id === 'planner' || role.id === 'developer' ? 'selected' : ''}>1명</option>
        <option value="2">2명</option>
        <option value="3">3명 (최대)</option>
      </select>
      <span class="role-desc">${role.description}</span>
    </div>
  `).join('');

  updateTeamConfig();
}

// 팀 구성 업데이트
function updateTeamConfig() {
  teamConfig = {};
  roles.forEach(role => {
    const select = document.getElementById(`role-${role.id}`);
    if (select) {
      teamConfig[role.id] = parseInt(select.value);
    }
  });
}

// 시작 버튼 클릭
startBtn.addEventListener('click', () => {
  const requirement = requirementInput.value.trim();
  if (!requirement) {
    alert('요구사항을 입력해주세요.');
    return;
  }

  // 최소 1명 기획자, 1명 개발자 확인
  if (!teamConfig.planner || teamConfig.planner < 1) {
    alert('기획자가 최소 1명 필요합니다.');
    return;
  }
  if (!teamConfig.developer || teamConfig.developer < 1) {
    alert('개발자가 최소 1명 필요합니다.');
    return;
  }

  const workPath = workPathInput.value.trim();

  // UI 전환
  startBtn.disabled = true;
  startBtn.textContent = '시작 중...';
  stopBtn.classList.remove('hidden');

  // 서버에 프로젝트 시작 요청
  socket.emit('start_project', {
    requirement,
    workPath: workPath || null,
    teamConfig
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
  questionSection.classList.add('hidden');
  answerTextarea.value = '';

  addConversation('user', '사용자', answer);
});

// Enter 키로 답변 전송
answerTextarea.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) {
    answerBtn.click();
  }
});

// 사용자 개입 전송
window.sendIntervention = function(command) {
  const message = interventionMessage.value.trim();
  socket.emit('user_intervention', { command, message });
  interventionSection.classList.add('hidden');
  interventionMessage.value = '';
};

// 문서 탭 전환
window.showDocTab = function(tab) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');

  specContent.classList.toggle('hidden', tab !== 'spec');
  designContent.classList.toggle('hidden', tab !== 'design');
};

// UI 초기화
function resetUI() {
  startBtn.disabled = false;
  startBtn.textContent = '시작';
  stopBtn.classList.add('hidden');

  configSection.classList.remove('hidden');
  progressSection.classList.add('hidden');
  conversationSection.classList.add('hidden');
  questionSection.classList.add('hidden');
  interventionSection.classList.add('hidden');
  docsSection.classList.add('hidden');
  resultSection.classList.add('hidden');

  conversationContainer.innerHTML = '';
  phaseProgress.innerHTML = '';
}

// 대화 추가
function addConversation(type, from, content) {
  const entry = document.createElement('div');
  entry.className = `conversation-entry ${type}`;

  const time = new Date().toLocaleTimeString();

  entry.innerHTML = `
    <div class="conv-header">
      <span class="conv-from">${from}</span>
      <span class="conv-time">${time}</span>
    </div>
    <div class="conv-content">${escapeHtml(content)}</div>
  `;

  conversationContainer.appendChild(entry);
  conversationContainer.scrollTop = conversationContainer.scrollHeight;
}

// HTML 이스케이프
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replace(/\n/g, '<br>');
}

// 진행 단계 렌더링
function renderPhaseProgress(phases, currentPhase) {
  phaseProgress.innerHTML = phases.map((phase, index) => {
    const role = roles.find(r => r.id === phase);
    const isCurrent = phase === currentPhase;
    const isPast = phases.indexOf(currentPhase) > index;

    return `
      <div class="phase-item ${isCurrent ? 'current' : ''} ${isPast ? 'done' : ''}">
        <span class="phase-icon">${role ? role.icon : '?'}</span>
        <span class="phase-name">${role ? role.name : phase}</span>
      </div>
      ${index < phases.length - 1 ? '<span class="phase-arrow">→</span>' : ''}
    `;
  }).join('');
}

// === 소켓 이벤트 핸들러 ===

socket.on('project_started', (data) => {
  console.log('프로젝트 시작:', data);

  configSection.classList.add('hidden');
  progressSection.classList.remove('hidden');
  conversationSection.classList.remove('hidden');
  docsSection.classList.remove('hidden');

  // 활성화된 단계 설정
  activePhases = Object.entries(teamConfig)
    .filter(([_, count]) => count > 0)
    .map(([roleId, _]) => roleId)
    .sort((a, b) => {
      const roleA = roles.find(r => r.id === a);
      const roleB = roles.find(r => r.id === b);
      return (roleA?.phase || 0) - (roleB?.phase || 0);
    });

  // 디자이너가 선택되지 않았으면 안내 메시지 표시
  if (!teamConfig.designer || teamConfig.designer === 0) {
    designContent.innerHTML = '<p class="placeholder">🎨 디자이너가 선택되지 않았습니다. 기획서의 UI/UX 섹션을 참고하세요.</p>';
  }

  addConversation('system', '시스템', `프로젝트 시작 - 경로: ${data.workspacePath}`);
});

socket.on('phase_change', (data) => {
  renderPhaseProgress(activePhases, data.phase);
  addConversation('system', '시스템', `=== ${data.phase}팀 시작 ===`);
});

socket.on('log', (data) => {
  const from = data.teamName || data.name || data.type;
  addConversation(data.type, from, data.message);
});

socket.on('conversation', (data) => {
  addConversation('agent', data.from, `→ ${data.to}: ${data.content}`);
});

socket.on('cli_output', (data) => {
  // CLI 출력은 대화에 추가
  if (data.data && data.data.trim()) {
    addConversation('cli', data.agent || data.role, data.data);
  }
});

socket.on('user_question', (data) => {
  questionSection.classList.remove('hidden');
  questionFrom.textContent = data.fromName || data.from;
  questionText.textContent = data.question;
  questionSection.scrollIntoView({ behavior: 'smooth' });
  answerTextarea.focus();

  addConversation('question', data.fromName || data.from, `질문: ${data.question}`);
});

socket.on('user_intervention_needed', (data) => {
  interventionSection.classList.remove('hidden');
  interventionReason.textContent = data.reason;
  retryCountEl.textContent = `반복 횟수: ${data.retryCount}/5`;
  interventionSection.scrollIntoView({ behavior: 'smooth' });

  addConversation('warning', '시스템', `⚠️ 문제 발생 (${data.retryCount}회 반복): ${data.reason}`);
});

socket.on('spec_updated', (data) => {
  specContent.innerHTML = `<pre>${escapeHtml(data.content)}</pre>`;
});

socket.on('design_updated', (data) => {
  designContent.innerHTML = `<pre>${escapeHtml(data.content)}</pre>`;
});

socket.on('file_created', (data) => {
  addConversation('file', '시스템', `📄 파일 생성: ${data.path}`);
});

socket.on('task_complete', (data) => {
  resultSection.classList.remove('hidden');
  resultContent.innerHTML = `<p>${escapeHtml(data.summary)}</p>`;

  if (data.files_created && data.files_created.length > 0) {
    filesList.innerHTML = '<h3>생성된 파일:</h3>' +
      data.files_created.map(file => `<div class="file-item">📄 ${file}</div>`).join('');
  }

  startBtn.disabled = false;
  startBtn.textContent = '새 프로젝트 시작';
  stopBtn.classList.add('hidden');

  addConversation('complete', '시스템', `✅ 프로젝트 완료!\n${data.summary}`);
});

socket.on('error', (data) => {
  addConversation('error', '에러', data.message);
  console.error('에러:', data.message);
});

socket.on('disconnect', () => {
  console.log('서버 연결 끊김');
  addConversation('error', '시스템', '서버 연결이 끊겼습니다.');
});
