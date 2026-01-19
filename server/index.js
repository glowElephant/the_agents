import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

import { PlannerAgent } from './agents/planner.js';
import { DeveloperAgent } from './agents/developer.js';
import { ConversationLogger } from './conversation-logger.js';

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

// 현재 활성 세션
const sessions = new Map();

// WebSocket 연결 처리
io.on('connection', (socket) => {
  console.log('클라이언트 연결됨:', socket.id);

  let currentSession = null;

  // 프로젝트 시작
  socket.on('start_project', async (data) => {
    const { requirement, workPath } = data;
    const projectId = uuidv4();

    console.log(`\n========================================`);
    console.log(`프로젝트 시작: ${projectId}`);
    console.log(`작업 경로: ${workPath || '기본 workspace'}`);
    console.log(`========================================\n`);

    // 작업 경로 설정
    const workspacePath = workPath || join(__dirname, '..', 'workspace', projectId);

    // 내부 이벤트 버스 생성
    const eventBus = new EventEmitter();

    // 대화 기록 로거 생성
    const logger = new ConversationLogger(workspacePath);

    // 에이전트 생성
    const plannerAgent = new PlannerAgent(projectId, workspacePath, io, eventBus, logger);
    const developerAgent = new DeveloperAgent(projectId, workspacePath, io, eventBus, logger);

    // 세션 저장
    currentSession = {
      projectId,
      workspacePath,
      plannerAgent,
      developerAgent,
      eventBus,
      logger
    };
    sessions.set(projectId, currentSession);
    sessions.set(socket.id, currentSession);

    // 초기 요구사항 기록
    logger.userToPlanner(requirement);

    // 이벤트 버스 핸들러 설정

    // 기획 → 개발: 기획 완료
    eventBus.on('planner_to_developer', async (data) => {
      console.log('\n[이벤트] 기획 → 개발: 기획 완료');
      logger.plannerToDeveloper(data.message);

      if (data.spec_complete) {
        try {
          if (!developerAgent.cli) {
            await developerAgent.start();
          }
          await developerAgent.startDevelopment(data.message);
        } catch (error) {
          console.error('개발 에이전트 에러:', error);
          io.emit('error', { message: error.message });
        }
      }
    });

    // 개발 → 기획: 질문
    eventBus.on('developer_to_planner', async (data) => {
      console.log('\n[이벤트] 개발 → 기획: 질문');
      logger.developerToPlanner(data.question);

      try {
        await plannerAgent.processDeveloperQuestion(data.question);
      } catch (error) {
        console.error('기획 에이전트 에러:', error);
        io.emit('error', { message: error.message });
      }
    });

    // 기획 → 개발: 답변
    eventBus.on('planner_reply', async (data) => {
      console.log('\n[이벤트] 기획 → 개발: 답변');
      logger.plannerReply(data.answer);

      try {
        await developerAgent.processPlannerAnswer(data.answer);
      } catch (error) {
        console.error('개발 에이전트 에러:', error);
        io.emit('error', { message: error.message });
      }
    });

    // 클라이언트에 프로젝트 ID 전송
    socket.emit('project_started', { projectId, workspacePath });

    // 기획 에이전트 시작 및 요구사항 전달
    try {
      await plannerAgent.start();
      await plannerAgent.processRequirement(requirement);
    } catch (error) {
      console.error('기획 에이전트 에러:', error);
      socket.emit('error', { message: error.message });
    }
  });

  // 사용자 답변
  socket.on('user_answer', async (data) => {
    const { answer } = data;
    const session = sessions.get(socket.id);

    console.log('\n[사용자 답변]', answer);

    if (session) {
      session.logger.userAnswer(answer);

      if (session.plannerAgent) {
        try {
          await session.plannerAgent.processUserAnswer(answer);
        } catch (error) {
          console.error('사용자 답변 처리 에러:', error);
          socket.emit('error', { message: error.message });
        }
      }
    }
  });

  // 대화 기록 요약 요청
  socket.on('get_conversation_summary', async () => {
    const session = sessions.get(socket.id);

    if (session && session.logger) {
      const summary = session.logger.generateSummary();
      const filepath = await session.logger.saveToFile();

      socket.emit('conversation_summary', {
        summary,
        filepath
      });
    }
  });

  // 프로젝트 중단
  socket.on('stop_project', () => {
    const session = sessions.get(socket.id);
    if (session) {
      console.log('\n[프로젝트 중단]', session.projectId);
      if (session.plannerAgent) session.plannerAgent.stop();
      if (session.developerAgent) session.developerAgent.stop();
      sessions.delete(socket.id);
      sessions.delete(session.projectId);
    }
  });

  socket.on('disconnect', () => {
    console.log('클라이언트 연결 해제:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║             The Agents - AI 협업 시스템                    ║
║                                                           ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║   서버 주소: http://localhost:${PORT}                        ║
║                                                           ║
║   사용법:                                                  ║
║   1. 브라우저에서 위 주소 접속                              ║
║   2. 요구사항 입력 + 작업 경로 설정                         ║
║   3. 기획 에이전트가 분석 시작                              ║
║   4. 질문에 답변하며 기획 완성                              ║
║   5. 개발 에이전트가 코드 작성                              ║
║   6. 완료 후 대화 기록 확인 가능                            ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});
