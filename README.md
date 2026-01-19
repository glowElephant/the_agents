# The Agents - AI 에이전트 협업 시스템

두 개의 AI 에이전트(기획자, 개발자)가 협력하여 사용자의 요구사항을 구현하는 시스템입니다.

## 구조

```
the_agents/
├── server/
│   ├── index.js              # 메인 서버 (Express + Socket.io)
│   ├── cli-wrapper.js        # Claude CLI 래퍼
│   ├── conversation-logger.js # 대화 기록 로거
│   └── agents/
│       ├── planner.js        # 기획 에이전트
│       └── developer.js      # 개발 에이전트
├── web/
│   ├── index.html            # 웹 UI
│   ├── style.css             # 스타일
│   └── app.js                # 클라이언트 JS
├── prompts/
│   ├── planner.md            # 기획 에이전트 시스템 프롬프트
│   └── developer.md          # 개발 에이전트 시스템 프롬프트
└── workspace/                # 프로젝트 작업 공간 (자동 생성)
```

## 요구사항

- Node.js 18+
- Claude CLI (`claude` 명령어 사용 가능해야 함)

## 설치

```bash
npm install
```

## 실행

```bash
npm start
```

브라우저에서 `http://localhost:3000` 접속

## 사용법

1. **요구사항 입력**: 만들고 싶은 것을 상세하게 설명
2. **작업 경로 설정** (선택): 코드가 생성될 경로 지정
3. **시작 버튼 클릭**
4. **에이전트 질문 답변**: 기획/개발 에이전트의 질문에 답변
5. **완료**: 생성된 파일 확인, 대화 기록 보기

## 작동 방식

### 에이전트 간 통신

```
사용자 → [요구사항] → 기획 에이전트
                         ↓
                    [질문] ← → [답변]
                         ↓
                    기획서 작성 (spec.md)
                         ↓
                    개발 에이전트
                         ↓
                    [질문] → 기획 에이전트 → [답변]
                         ↓
                    코드 작성
                         ↓
                       완료
```

### 액션 태그

에이전트들은 다음 태그로 액션을 수행합니다:

**기획 에이전트:**
- `[ASK_USER]...[/ASK_USER]` - 사용자에게 질문
- `[UPDATE_SPEC]...[/UPDATE_SPEC]` - 기획서 업데이트
- `[SEND_TO_DEVELOPER]...[/SEND_TO_DEVELOPER]` - 개발 에이전트에게 전달
- `[REPLY_TO_DEVELOPER]...[/REPLY_TO_DEVELOPER]` - 개발 에이전트 질문에 답변

**개발 에이전트:**
- `[ASK_PLANNER]...[/ASK_PLANNER]` - 기획 에이전트에게 질문
- `[WRITE_FILE:경로]...[/WRITE_FILE]` - 파일 작성
- `[PROGRESS]...[/PROGRESS]` - 진행 상황 보고
- `[TASK_COMPLETE]...[/TASK_COMPLETE]` - 작업 완료

## 권한 설정

- **기획 에이전트**: `acceptEdits` - 파일 편집만 허용
- **개발 에이전트**: `bypassPermissions` - 모든 권한 허용

작업 경로를 미리 신뢰하려면:
```bash
cd /path/to/work
claude
# 신뢰 확인 후 종료
```

## 대화 기록

프로젝트 완료 후 "대화 기록 보기" 버튼으로 전체 대화를 확인할 수 있습니다.
기록은 `workspace/{project-id}/logs/` 에 저장됩니다.

## 라이선스

MIT
