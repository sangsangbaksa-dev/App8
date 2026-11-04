# 견적 정확도 체크

프리랜서를 위한 견적 정확도 분석 웹앱 (정적 HTML/CSS/ES 모듈, 빌드 없음).

## 실행
```
python3 -m http.server 8000
```
브라우저에서 http://localhost:8000 을 엽니다 (ES 모듈이라 file:// 로는 동작하지 않을 수 있음).

## 테스트
```
npm test            # = node --test tests/*.test.js
node --test         # tests/ 자동 탐색
```
참고: Node 22에서는 `node --test tests/` (디렉터리 인자)가 모듈 경로로 해석되어 실패합니다.

## 구조
- `logic.js` 순수 함수 (computeStats, categoryBreakdown, suggestion, validateRecord)
- `app.js` DOM 연결, `styles.css` 디자인, `tests/logic.test.js` 단위 테스트
