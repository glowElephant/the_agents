import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';

import { ProjectManager } from './project-manager.js';
import { getRoleList } from './roles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 정적 파일 서빙
app.use(express.static(join(__dirname, '..', 'web')));

// API: 역할 목록
app.get('/api/roles', (req, res) => {
  res.json(getRoleList());
});

// 현재 활성 세션
const sessions = new Map();

// WebSocket 연결 처리
io.on('connection', (socket) => {
  console.log('클라이언트 연결됨:', socket.id);

  let currentSession = null;

  // 역할 목록 요청
  socket.on('get_roles', () => {
    socket.emit('roles', getRoleList());
  });

  // 프로젝트 시작
  socket.on('start_project', async (data) => {
    const { requirement, workPath, teamConfig } = data;
    const projectId = uuidv4();

    console.log(`\n${'='.repeat(50)}`);
    console.log(`프로젝트 시작: ${projectId}`);
    console.log(`작업 경로: ${workPath || '기본 workspace'}`);
    console.log(`팀 구성:`, teamConfig);
    console.log(`${'='.repeat(50)}\n`);

    // 작업 경로 설정
    const workspacePath = workPath || join(__dirname, '..', 'workspace', projectId);

    // 프로젝트 매니저 생성
    const projectManager = new ProjectManager(workspacePath, teamConfig, io);

    // 세션 저장
    currentSession = {
      projectId,
      workspacePath,
      projectManager
    };
    sessions.set(projectId, currentSession);
    sessions.set(socket.id, currentSession);

    // 클라이언트에 프로젝트 ID 전송
    socket.emit('project_started', { projectId, workspacePath });

    try {
      // 초기화 및 시작
      await projectManager.initialize();
      await projectManager.start(requirement);
    } catch (error) {
      console.error('프로젝트 에러:', error);
      socket.emit('error', { message: error.message });
    }
  });

  // 사용자 답변
  socket.on('user_answer', async (data) => {
    const { answer } = data;
    const session = sessions.get(socket.id);

    console.log('\n[사용자 답변]', answer);

    if (session && session.projectManager) {
      try {
        await session.projectManager.handleUserAnswer(answer);
      } catch (error) {
        console.error('사용자 답변 처리 에러:', error);
        socket.emit('error', { message: error.message });
      }
    }
  });

  // 사용자 개입 (무한루프 시)
  socket.on('user_intervention', async (data) => {
    const { command, message } = data;
    const session = sessions.get(socket.id);

    console.log('\n[사용자 개입]', command, message);

    if (session && session.projectManager) {
      try {
        await session.projectManager.handleUserIntervention(command, message);
      } catch (error) {
        console.error('사용자 개입 처리 에러:', error);
        socket.emit('error', { message: error.message });
      }
    }
  });

  // 프로젝트 중단
  socket.on('stop_project', () => {
    const session = sessions.get(socket.id);
    if (session) {
      console.log('\n[프로젝트 중단]', session.projectId);
      if (session.projectManager) {
        session.projectManager.stop();
      }
      sessions.delete(socket.id);
      sessions.delete(session.projectId);
    }
  });

  socket.on('disconnect', () => {
    console.log('클라이언트 연결 해제:', socket.id);
    const session = sessions.get(socket.id);
    if (session && session.projectManager) {
      session.projectManager.stop();
    }
    sessions.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║         The Agents v2.0 - 멀티 에이전트 협업 시스템         ║
║                                                           ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║   서버 주소: http://localhost:${PORT}                        ║
║                                                           ║
║   새로운 기능:                                              ║
║   • 역할별 다수 에이전트 (최대 3명)                          ║
║   • 팀 내 토론 (팀장 + 팀원)                                ║
║   • 팀 간 순차 진행 및 롤백                                 ║
║   • 무한루프 감지 및 사용자 개입                            ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});
