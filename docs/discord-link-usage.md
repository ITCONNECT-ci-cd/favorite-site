# 디스코드 링크 저장 사용 안내

2026-09-10 Favorite 전용 순차 처리 어댑터 v1.4.0을 로컬 운영 프로필에 적용했다.

## 사용하는 방법

- 링크를 하나씩 연달아 보내도 된다. 앞 메시지의 답변을 기다릴 필요가 없다.
- 한 메시지에 모아서 보낼 때는 URL을 한 줄씩, 최대 5개까지 넣는다. 초과하면 별도 메시지로 보내라는 안내가 나온다.
- `⏳` 반응은 접수 표시다. 저장 성공·중복·실패는 각 메시지에 달리는 결과 답변으로 확인한다. Discord 반응 권한이나 전송 장애가 있으면 접수 표시가 보이지 않을 수 있다.
- 동시 미완료 메시지는 최대 32개까지 접수한다. 가득 차거나 접수 기록을 저장하지 못하면 다시 보내 달라고 알린다.
- 기존 메시지 편집으로 링크를 추가하지 말고 새 메시지로 보낸다.
- 속도 제한 안내가 오면 안내된 재시도 시각까지 기다린다. 링크를 모아 보내도 URL별 호출 제한은 유지된다.

## 처리 방식

`integrations/hermes/favorite-message-context/serial_queue.py`가 설정된 Favorite 채널의 원본 이벤트를 별도 FIFO에 넣는다. Discord의 최초 텍스트 batching과 Hermes의 busy interrupt/merge 경로보다 먼저 접수하며, 현재 턴의 응답 전송·정리가 끝난 뒤 다음 이벤트를 넘긴다. 메시지 ID는 기존 ContextVar/middleware 경로로 저장 API까지 전달된다.

Hermes의 공개 `register_platform` 확장으로 해당 프로필의 Discord 어댑터만 교체한다. 내장 어댑터의 인증·채널·멘션 설정 연결을 재사용한다. 공통 Hermes 소스와 다른 프로필은 수정하지 않는다. URL이 없는 일반 질문도 기존 채널 프롬프트에 따라 순서대로 처리하며 저장 작업에 끼어들지 않는다. 명시적인 제어 명령은 기존 동작을 유지한다.

접수 원문은 프로필의 `state/favorite-queue/<message-id>.json`에 원자적으로 저장한 후 접수 표시를 시도한다. 파일은 0600, 디렉터리는 0700 권한이다. 턴이 끝난 항목은 제거하고, 프로세스 종료로 남은 항목은 재시작 후 원래 메시지 ID와 원문으로 처리한다. 복구 시 이전 역할 기반 권한은 재사용하지 않고 현재 gateway 사용자 인증을 거친다. 수신 당시 어댑터의 인증·채널 제한도 그대로 적용된다.

이 대기열은 접수한 메시지의 처리 생명주기를 보관한다. URL별 저장 결과와 중복 방지는 기존 ingest API/DB receipt가 담당한다. 저장 직후 프로세스가 종료되어 같은 메시지를 다시 처리해도 기존 멱등 키를 사용한다. 일반 처리 오류는 다음 메시지를 막지 않고 원문을 남긴다. API 결과의 재시도 규칙은 그대로이며, 속도 제한을 별도 예약 작업으로 자동 재시도하는 기능은 추가하지 않았다. 봇이 수신하지 못한 과거 메시지를 이번 기능이 소급 수집하지는 않는다.

## 검증과 운영 반영

- 실제 서비스 런타임: `/Users/itconnect/Applications/Agents/hermes-agent/venv/bin/python`. 별도 설치인 `~/.hermes/hermes-agent`와 구분했다.
- 가짜 Discord/LLM과 설치된 Hermes base adapter를 사용한 테스트 17개 통과: 시작 직전 및 처리 중 연속 10건, 원본 ID·순서·본문 보존, 초과 링크 안내, 접수 한도, 디스크 오류, 처리 실패 격리, 재시작 복구, 시작 시 복구 대기, 동일 어댑터 재연결, 파일 권한, 인증 설정 연결.
- 임시 프로필에서 실제 플러그인 탐색 및 `FavoriteDiscordAdapter` 등록 확인.
- 2026-09-10 08:00 KST 운영 프로필 적용 후 정상 재시작. 새 PID 72007, gateway `running`, Discord `connected`, 로그 `Favorite FIFO ready: channels=1 pending=0` 확인.
- 실제 Discord 새 메시지 전송, LLM 호출·운영 DB 저장 대조는 이번 검증에서 수행하지 않았다. 과거 누락 건의 원인과 복구 완료도 확정하지 않는다.

```sh
PYTHONDONTWRITEBYTECODE=1 /Users/itconnect/Applications/Agents/hermes-agent/venv/bin/python -m unittest discover -s integrations/hermes/favorite-message-context -p 'test_*.py'
PYTHONDONTWRITEBYTECODE=1 /Users/itconnect/Applications/Agents/hermes-agent/venv/bin/python scripts/install-favorite-queue.py --profile-home /Users/itconnect/.hermes/profiles/favorite --channel 1536239187517247488 --check
```

설치 스크립트는 `--check`를 빼면 기존 설정과 플러그인을 비공개 백업한 뒤 설치한다. 서비스 재시작은 별도다. 이번 원본 백업은 프로필 아래 `state/queue-install-backups/20260909T225653.458887Z`에 있다. 되돌릴 때는 Favorite 서비스가 처리 중인지 확인한 뒤 이 백업의 설정·플러그인을 복원하고 재시작한다. 대기열 원문 파일은 삭제하지 않는다.
