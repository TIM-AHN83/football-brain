// 배포 설정 — 공개 키(anon)만 넣는다. 랭킹 표는 supabase/fb_leaderboard.sql 로 만든다.
export const CONFIG = {
  version: '1.2.1 (2026-11-10)',
  supabase: {
    url: 'https://ykqqizjjxzisankhjash.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrcXFpempqeHppc2Fua2hqYXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1NjIwOTQsImV4cCI6MjEwODEzODA5NH0.A248gIV1Agaq1HtXUEnG4ZETCLaktT7M9uA0HPHrGN0',
  },
  instagram: 'halftime.parenttalk',
  // web/sfx/ 에 실제 녹음 파일을 넣었다면 이름을 적는다 (예: ['crowd', 'kick']). 비어 있으면 전부 합성음.
  sfx: [],
};
