// secrets.example.js
//
// 이 파일을 복사해서 같은 폴더에 secrets.js 라는 이름으로 저장한 뒤,
// 아래 두 값을 자기 것으로 바꾸면 된다.
//
// secrets.js는 .gitignore에 들어 있어서 GitHub에 올라가지 않는다.
// 이 example 파일만 저장소에 남아 "무엇을 채워야 하는지"를 알려준다.
//
//
// 값을 어디서 찾나:
//   Supabase 대시보드 > 왼쪽 아래 Project Settings > API
//     Project URL          -> url
//     Project API keys > anon public  -> anonKey
//
//
// ★ service_role 키는 절대 여기 넣지 말 것.
//   그 키는 RLS(접근 제한)를 통째로 무시한다. 확장 프로그램은 사용자 PC에서
//   도는 코드라 누구나 파일을 열어볼 수 있으므로, 넣는 순간 DB 전체가 열린다.
//   여기에 넣을 것은 anon 키뿐이다.
//
//
// anon 키는 공개돼도 되나?
//   원래 공개를 전제로 만든 키다. 다만 그건 RLS를 켜 뒀을 때 얘기다.
//   supabase/schema.sql에서 '넣기'만 허용해 두었으므로,
//   이 키를 주워도 남의 기록을 읽거나 지울 수는 없다.

const SUPABASE = {
  url: 'https://프로젝트id.supabase.co',
  anonKey: 'eyJ로-시작하는-anon-public-키'
};
