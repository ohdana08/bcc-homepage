/**
 * BCC 잇툴즈 리드 컬렉터 v2
 * --------------------------------------------------------------
 * - 이메일을 고유 식별자로 사용하는 upsert 방식
 * - 같은 사용자가 여러 번 등록해도 행이 추가되지 않음 (기존 행 갱신)
 * - 사용 도구 누적·방문 횟수·첫/최근 방문일 자동 관리
 * - 도구 측 코드는 변경 없이 v1과 동일한 페이로드를 받음
 *   (name, phone, email, privacyConsent, marketingConsent,
 *    tool, subtool, category, keyword, activity, ...)
 *
 * 시트 컬럼 (v2):
 *   A 이름 · B 전화 · C 이메일 · D 첫 방문일 · E 최근 방문일
 *   F 방문 횟수 · G 사용 도구 (쉼표 구분) · H 가장 자주 쓰는 도구
 *   I 마케팅 동의 · J 충성 사용자 (방문 ≥ 3)
 *   K 도구별 카운트 (JSON) · L 마지막 활동 (JSON)
 *
 * 기존 시트 데이터는 migrateExistingRows() 함수를 한 번 실행하면
 * 새 컬럼이 채워짐 (첫·최근 방문일 = 이메일이 처음 보인 row의 timestamp).
 *
 * 배포:
 *   1) script.google.com → 기존 BCC 리드 수집 프로젝트 열기
 *   2) 본 코드 전체로 교체
 *   3) (1회) migrateExistingRows() 실행 — 권한 승인 후 메뉴
 *      [실행] → [migrateExistingRows] 클릭
 *   4) [배포] → [배포 관리] → [편집] → [새 버전] → [배포]
 *      ✔ 기존 웹앱 URL 변경 없음 — 모든 도구 코드 수정 불필요
 */

// =============== 설정 ===============
var SHEET_NAME = '리드';           // 시트 탭 이름 (기존 그대로)
var LOYAL_THRESHOLD = 3;           // 방문 N회 이상 → 충성 사용자
var COLS = {
  NAME:        1,  // A
  PHONE:       2,  // B
  EMAIL:       3,  // C  (key)
  FIRST_VISIT: 4,  // D
  LAST_VISIT:  5,  // E
  VISIT_COUNT: 6,  // F
  TOOLS:       7,  // G  (쉼표 구분)
  TOP_TOOL:    8,  // H
  MARKETING:   9,  // I
  LOYAL:      10,  // J
  TOOL_COUNTS:11,  // K  (JSON)
  LAST_ACT:   12,  // L  (JSON)
};
var HEADER = [
  '이름','전화','이메일','첫 방문일','최근 방문일','방문 횟수',
  '사용 도구','가장 자주 쓰는 도구','마케팅 동의','충성 사용자',
  '도구별 카운트(JSON)','마지막 활동(JSON)'
];

// =============== 엔드포인트 ===============
function doPost(e) {
  var body = parsePayload_(e);
  if (!body) return jsonOk_({ ok: false, error: 'invalid_payload' });

  var email = String(body.email || '').trim().toLowerCase();
  if (!email) return jsonOk_({ ok: false, error: 'missing_email' });

  var sheet = getOrCreateSheet_();
  ensureHeader_(sheet);

  var now = new Date();
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15 * 1000);

    var rowIndex = findRowByEmail_(sheet, email);
    if (rowIndex === -1) {
      var result = insertNewLead_(sheet, body, email, now);
      if (result.isLoyal) console.log('[LOYAL] new user reached loyalty unexpectedly: ' + email);
      return jsonOk_({ ok: true, mode: 'created', row: result.row });
    } else {
      var updateResult = updateExistingLead_(sheet, rowIndex, body, now);
      if (updateResult.becameLoyal) {
        console.log('[LOYAL] ' + email + ' just became loyal (visit ' + updateResult.visitCount + '). Top tool: ' + updateResult.topTool);
        // TODO: 추후 슬랙/이메일 알림 연동 지점
      }
      return jsonOk_({ ok: true, mode: 'updated', row: rowIndex, visitCount: updateResult.visitCount, loyal: updateResult.becameLoyal });
    }
  } catch (err) {
    console.error('[ERROR]', err && err.stack || err);
    return jsonOk_({ ok: false, error: 'internal', message: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function doGet() {
  return ContentService.createTextOutput('BCC 잇툴즈 리드 컬렉터 v2 · POST only').setMimeType(ContentService.MimeType.TEXT);
}

// =============== 파싱 ===============
function parsePayload_(e) {
  if (!e) return null;
  var raw = '';
  try {
    if (e.postData && typeof e.postData.contents === 'string') {
      raw = e.postData.contents;
    } else if (e.parameter && e.parameter.payload) {
      raw = e.parameter.payload;
    }
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('parsePayload_ failed', err);
    return null;
  }
}

// =============== 시트 헬퍼 ===============
function getOrCreateSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  return sheet;
}

function ensureHeader_(sheet) {
  var firstRow = sheet.getRange(1, 1, 1, HEADER.length).getValues()[0];
  var needs = false;
  for (var i = 0; i < HEADER.length; i++) {
    if (firstRow[i] !== HEADER[i]) { needs = true; break; }
  }
  if (needs) {
    sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
    sheet.setFrozenRows(1);
    var headerRange = sheet.getRange(1, 1, 1, HEADER.length);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#0a0a0a');
    headerRange.setFontColor('#C9A84C');
  }
}

function findRowByEmail_(sheet, emailLower) {
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var emails = sheet.getRange(2, COLS.EMAIL, last - 1, 1).getValues();
  for (var i = 0; i < emails.length; i++) {
    var v = (emails[i][0] || '').toString().trim().toLowerCase();
    if (v === emailLower) return i + 2; // header row offset
  }
  return -1;
}

// =============== 신규 리드 ===============
function insertNewLead_(sheet, body, emailLower, now) {
  var toolKey = composeToolKey_(body);
  var toolCounts = {};
  if (toolKey) toolCounts[toolKey] = 1;

  var row = [
    body.name || '',
    body.phone || '',
    emailLower,
    now,                  // 첫 방문일
    now,                  // 최근 방문일
    1,                    // 방문 횟수
    toolKey,              // 사용 도구
    toolKey,              // 가장 자주 쓰는 도구
    !!body.marketingConsent,
    false,                // 충성
    JSON.stringify(toolCounts),
    JSON.stringify({ tool: toolKey, activity: body.activity || 'lead_submitted', at: now.toISOString() })
  ];
  sheet.appendRow(row);
  var rowIndex = sheet.getLastRow();
  return { row: rowIndex, isLoyal: false };
}

// =============== 기존 리드 ===============
function updateExistingLead_(sheet, rowIndex, body, now) {
  var existing = sheet.getRange(rowIndex, 1, 1, HEADER.length).getValues()[0];

  // 1) 이름·전화: 최신 값으로 갱신 (빈 값이면 기존 유지)
  if (body.name && String(body.name).trim()) existing[COLS.NAME - 1] = body.name;
  if (body.phone && String(body.phone).trim()) existing[COLS.PHONE - 1] = body.phone;

  // 2) 첫 방문일: 비어있으면 backfill, 그 외 유지
  if (!existing[COLS.FIRST_VISIT - 1]) existing[COLS.FIRST_VISIT - 1] = now;

  // 3) 최근 방문일: 항상 now
  existing[COLS.LAST_VISIT - 1] = now;

  // 4) 방문 횟수 +1
  var visitCount = (parseInt(existing[COLS.VISIT_COUNT - 1] || 0) || 0) + 1;
  existing[COLS.VISIT_COUNT - 1] = visitCount;

  // 5) 사용 도구 누적
  var toolsListStr = String(existing[COLS.TOOLS - 1] || '').trim();
  var toolsList = toolsListStr ? toolsListStr.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
  var toolKey = composeToolKey_(body);
  if (toolKey && toolsList.indexOf(toolKey) === -1) toolsList.push(toolKey);
  existing[COLS.TOOLS - 1] = toolsList.join(', ');

  // 6) 도구별 카운트 (JSON)
  var toolCounts = {};
  try { toolCounts = JSON.parse(existing[COLS.TOOL_COUNTS - 1] || '{}') || {}; }
  catch (e) { toolCounts = {}; }
  if (toolKey) toolCounts[toolKey] = (toolCounts[toolKey] || 0) + 1;
  existing[COLS.TOOL_COUNTS - 1] = JSON.stringify(toolCounts);

  // 7) 가장 자주 쓰는 도구
  existing[COLS.TOP_TOOL - 1] = pickTopTool_(toolCounts);

  // 8) 마케팅 동의: 한 번이라도 동의했으면 true 유지
  if (body.marketingConsent) existing[COLS.MARKETING - 1] = true;

  // 9) 충성 사용자
  var wasLoyal = !!existing[COLS.LOYAL - 1];
  var isLoyalNow = visitCount >= LOYAL_THRESHOLD;
  existing[COLS.LOYAL - 1] = isLoyalNow;

  // 10) 마지막 활동 메타
  existing[COLS.LAST_ACT - 1] = JSON.stringify({
    tool: toolKey,
    activity: body.activity || 'lead_submitted',
    at: now.toISOString()
  });

  sheet.getRange(rowIndex, 1, 1, HEADER.length).setValues([existing]);
  return {
    visitCount: visitCount,
    becameLoyal: !wasLoyal && isLoyalNow,
    topTool: existing[COLS.TOP_TOOL - 1]
  };
}

// =============== 도구 식별자 ===============
/**
 * 도구 측 페이로드에서 일관된 도구 키 생성.
 * 우선순위: subtool → tool → category. 활동이 분석/PDF면 그 활동 키로 분기.
 */
function composeToolKey_(body) {
  var subtool = body && body.subtool ? String(body.subtool).trim() : '';
  if (subtool) return subtool;
  var tool = body && body.tool ? String(body.tool).trim() : '';
  if (tool) return tool;
  var cat = body && body.category ? String(body.category).trim() : '';
  return cat || '';
}

function pickTopTool_(counts) {
  var best = '';
  var max = 0;
  for (var k in counts) {
    if (counts.hasOwnProperty(k) && counts[k] > max) { max = counts[k]; best = k; }
  }
  return best;
}

// =============== 응답 ===============
function jsonOk_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// =============== 마이그레이션 ===============
/**
 * 기존 시트(v1 컬럼) → v2 컬럼 구조로 한 번에 정리.
 *
 * 동작:
 *   - 기존 행을 이메일 기준으로 그룹핑
 *   - 같은 이메일 행이 여러 개면: 가장 이른 timestamp = 첫 방문일,
 *     가장 늦은 timestamp = 최근 방문일, 방문 횟수 = 행 개수,
 *     사용 도구 = 모든 subtool/tool union,
 *     마케팅 동의 = 어느 한 번이라도 true면 true
 *     → 첫 행만 남기고 나머지 행 삭제
 *   - 단일 이메일 행: 첫·최근 방문일 = 그 행의 timestamp (없으면 now),
 *     방문 횟수 = 1
 *
 * 안전 장치: 백업 시트 자동 생성. 문제 발생 시 백업으로 복원 가능.
 *
 * 실행: Apps Script 에디터 메뉴 [실행] → [migrateExistingRows]
 */
function migrateExistingRows() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('SHEET_NAME "' + SHEET_NAME + '" not found');

  // 1) 백업
  var backupName = SHEET_NAME + '_backup_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  sheet.copyTo(ss).setName(backupName);
  console.log('Backup created: ' + backupName);

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    console.log('No data rows to migrate. Writing fresh header.');
    sheet.clear();
    ensureHeader_(sheet);
    return;
  }

  // 2) v1 컬럼 추정: 컬럼명을 보고 매핑
  var v1Header = data[0].map(function (h) { return String(h || '').trim(); });
  function findCol(candidates) {
    for (var i = 0; i < v1Header.length; i++) {
      for (var j = 0; j < candidates.length; j++) {
        if (v1Header[i] === candidates[j]) return i;
      }
    }
    return -1;
  }
  var iName  = findCol(['이름', 'name', 'Name']);
  var iPhone = findCol(['전화', '전화번호', 'phone']);
  var iEmail = findCol(['이메일', 'email']);
  var iTool  = findCol(['도구', 'tool', '서비스']);
  var iSubtool = findCol(['subtool', '세부도구']);
  var iCategory = findCol(['카테고리', 'category']);
  var iKeyword = findCol(['키워드', 'keyword']);
  var iMarketing = findCol(['마케팅', '마케팅 동의', 'marketing', 'marketingConsent']);
  var iTimestamp = findCol(['timestamp', '시각', '입력시각', '날짜']);
  // 컬럼 헤더 인식 실패 시 fallback: 첫 행이 헤더가 아닐 수도 있음 → 그 경우 0,1,2,...로 가정
  var hasHeaderRow = iName !== -1 || iEmail !== -1;
  var startRow = hasHeaderRow ? 1 : 0;
  if (!hasHeaderRow) {
    console.warn('v1 header not recognized — assuming column order: name, phone, email, ...');
    iName = 0; iPhone = 1; iEmail = 2;
  }
  if (iEmail === -1) throw new Error('Email column not found — cannot migrate');

  var byEmail = {};
  for (var r = startRow; r < data.length; r++) {
    var row = data[r];
    var emailRaw = row[iEmail];
    var email = String(emailRaw || '').trim().toLowerCase();
    if (!email) continue;
    var ts = iTimestamp !== -1 ? row[iTimestamp] : null;
    var tsDate = ts instanceof Date ? ts : (ts ? new Date(ts) : null);
    if (!tsDate || isNaN(tsDate.getTime())) tsDate = new Date();
    var toolKey = '';
    if (iSubtool !== -1 && row[iSubtool]) toolKey = String(row[iSubtool]).trim();
    else if (iTool !== -1 && row[iTool]) toolKey = String(row[iTool]).trim();
    else if (iCategory !== -1 && row[iCategory]) toolKey = String(row[iCategory]).trim();
    var marketing = iMarketing !== -1 && (row[iMarketing] === true || String(row[iMarketing]).toLowerCase() === 'true' || row[iMarketing] === 'TRUE');
    var name = iName !== -1 ? row[iName] : '';
    var phone = iPhone !== -1 ? row[iPhone] : '';

    if (!byEmail[email]) {
      byEmail[email] = {
        name: name || '',
        phone: phone || '',
        email: email,
        firstVisit: tsDate,
        lastVisit: tsDate,
        visitCount: 0,
        toolSet: {},
        toolCounts: {},
        marketing: false
      };
    }
    var agg = byEmail[email];
    if (name && !agg.name) agg.name = name;
    if (phone && !agg.phone) agg.phone = phone;
    if (tsDate < agg.firstVisit) agg.firstVisit = tsDate;
    if (tsDate > agg.lastVisit) agg.lastVisit = tsDate;
    agg.visitCount += 1;
    if (toolKey) {
      agg.toolSet[toolKey] = true;
      agg.toolCounts[toolKey] = (agg.toolCounts[toolKey] || 0) + 1;
    }
    if (marketing) agg.marketing = true;
  }

  // 3) 시트 비우고 v2 헤더 + 집계 행 재작성
  sheet.clear();
  ensureHeader_(sheet);

  var rowsToWrite = [];
  for (var em in byEmail) {
    if (!byEmail.hasOwnProperty(em)) continue;
    var a = byEmail[em];
    var tools = Object.keys(a.toolSet);
    var top = pickTopTool_(a.toolCounts);
    rowsToWrite.push([
      a.name, a.phone, a.email, a.firstVisit, a.lastVisit, a.visitCount,
      tools.join(', '), top, a.marketing, a.visitCount >= LOYAL_THRESHOLD,
      JSON.stringify(a.toolCounts),
      JSON.stringify({ tool: top, activity: 'migrated', at: new Date().toISOString() })
    ]);
  }
  if (rowsToWrite.length) {
    sheet.getRange(2, 1, rowsToWrite.length, HEADER.length).setValues(rowsToWrite);
  }
  console.log('Migrated rows: ' + rowsToWrite.length);
  console.log('Loyal users (≥' + LOYAL_THRESHOLD + ' visits): ' + rowsToWrite.filter(function (r) { return r[COLS.LOYAL - 1]; }).length);
}

// =============== 디버그 / 테스트 ===============
function testInsert() {
  var sheet = getOrCreateSheet_();
  ensureHeader_(sheet);
  doPost({
    postData: {
      contents: JSON.stringify({
        name: '테스트',
        phone: '010-0000-0000',
        email: 'test+' + Date.now() + '@example.com',
        privacyConsent: true,
        marketingConsent: false,
        tool: 'BCC 유튜브 분석기',
        subtool: 'finder',
        category: '유튜브'
      })
    }
  });
}

function testUpdate() {
  // Run after testInsert with the same email to verify upsert behavior
  doPost({
    postData: {
      contents: JSON.stringify({
        name: '테스트',
        phone: '010-0000-0000',
        email: 'test-fixed@example.com',
        privacyConsent: true,
        marketingConsent: true,
        tool: 'BCC 유튜브 분석기',
        subtool: 'video-analyzer',
        category: '유튜브',
        activity: 'guide_generated'
      })
    }
  });
}

function dumpSheet() {
  var sheet = getOrCreateSheet_();
  console.log(JSON.stringify(sheet.getDataRange().getValues(), null, 2));
}
