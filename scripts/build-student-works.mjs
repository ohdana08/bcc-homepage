import { readFileSync, writeFileSync } from 'node:fs';
const works = JSON.parse(readFileSync(new URL('../student-works/works.json', import.meta.url), 'utf8'));
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const image = (item, lazy = true) => `<img src="${esc(item.src)}" alt="${esc(item.alt)}"${lazy ? ' loading="lazy"' : ''}>`;
const details = work => work.images.map((item, i) => `<figure>${image(item)}<figcaption><span>${esc(item.alt)}</span><a class="link" href="${esc(item.src)}" target="_blank" rel="noopener">이미지 ${i + 1} 크게 열기 ↗</a></figcaption></figure>`).join('');
const card = (work, home = false) => `<article class="sw-card"${home ? '' : ` id="${esc(work.id)}" data-work data-category="${esc(work.category)}"`}>
  <a class="sw-preview" href="${home ? `/student-works/#${esc(work.id)}` : esc(work.images[0].src)}"${home ? '' : ' data-preview'} aria-label="${esc(work.title)} ${home ? '작품 보기' : '크게 보기'}">${image(work.images[0])}<span class="sw-preview-label">${home ? '작품 보기 ↗' : `${work.images.length}장 크게 보기`}</span></a>
  <div class="sw-card-body"><p class="sw-category">${esc(work.category)}</p><h3>${esc(work.title)}</h3><p class="sw-course">${esc(work.course)}</p>${home ? '' : `<p class="sw-description">${esc(work.description)}</p><div class="sw-card-links">${work.images.map((item, i) => `<a class="link" href="${esc(item.src)}" target="_blank" rel="noopener">이미지 ${i + 1} 열기 ↗</a>`).join('')}${work.download ? `<a class="link" href="${esc(work.download.src)}" download>${esc(work.download.label)} ↓</a>` : ''}${work.record ? `<a class="link" href="${esc(work.record)}">수업 기록 →</a>` : ''}</div>`}</div>${home ? '' : `<template>${details(work)}</template>`}
</article>`;
const categories = ['전체', ...new Set(works.map(w => w.category))];
const structured = {'@context':'https://schema.org','@type':'CollectionPage',name:'교육생 작품 모아보기 | BCC',url:'https://bccconsulting.kr/student-works/',description:'BCC 교육에서 만든 홈페이지, 홍보 콘텐츠, 숏폼 장면, 기획 슬라이드를 모았습니다.',isPartOf:{'@id':'https://bccconsulting.kr/#website'},mainEntity:{'@type':'ItemList',numberOfItems:works.length,itemListElement:works.map((w,i)=>({'@type':'ListItem',position:i+1,name:w.title,url:`https://bccconsulting.kr/student-works/#${w.id}`}))}};
const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>교육생 작품 모아보기 | BCC AI 활용 교육</title>
<meta name="description" content="BCC 교육생이 수업에서 만든 홈페이지, 홍보 콘텐츠, 숏폼 장면과 기획 슬라이드를 살펴보세요. 작품 종류별로 모아 보고 이미지를 크게 확인할 수 있습니다.">
<link rel="canonical" href="https://bccconsulting.kr/student-works/">
<meta property="og:type" content="website"><meta property="og:title" content="교육생 작품 모아보기 | BCC AI 활용 교육"><meta property="og:description" content="수업에서 만든 홈페이지·홍보 콘텐츠·영상 기획·슬라이드를 한곳에서."><meta property="og:url" content="https://bccconsulting.kr/student-works/"><meta property="og:image" content="https://bccconsulting.kr/assets/results/craft-blog-teddy-01.jpg">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css">
<link rel="stylesheet" href="/assets/home-2026.css?v=20261030i"><link rel="stylesheet" href="/assets/student-works.css?v=20261117a">
<script defer src="/assets/bcc-analytics.js?v=20261116a"></script><script defer src="/assets/student-works.js?v=20261117a"></script>
<script type="application/ld+json">${JSON.stringify(structured)}</script>
</head>
<body class="sw-page">
<a class="sw-skip" href="#works">작품 목록으로 바로 가기</a>
<nav class="nav" aria-label="주 메뉴"><div class="nav-inner"><a class="brand" href="/"><img src="/logo.png?v=3" alt="BCC 로고"><div><div class="brand-name">BCC</div><div class="brand-sub">비즈니스커리어컨설팅</div></div></a><div class="nav-links"><a href="/education.html">기관 교육</a><a href="/cases/">교육 사례</a><a href="/lecture-request/?utm_source=student_works&amp;utm_medium=nav&amp;utm_campaign=always_on">교육 문의</a></div></div></nav>
<main>
<header class="sw-hero"><div class="inner"><a class="sw-back" href="/#student-works">← 홈페이지로 돌아가기</a><p class="eyebrow">교육생 작품</p><h1>배운 내용이,<br>이런 작품으로 남았습니다.</h1><p class="lead">내 업무 아이디어로 만든 홈페이지부터 상품을 소개하는 이미지까지.<br>각 과정에서 만든 작품을 종류별로 살펴보세요.</p></div></header>
<section class="sw-library" id="works" aria-label="등록된 교육생 작품" data-works-library><div class="inner">
<div class="sw-tools" data-works-tools hidden><div class="sw-filter" role="group" aria-label="작품 종류">${categories.map((c,i)=>`<button type="button" data-filter="${esc(c)}" aria-pressed="${i===0}">${esc(c)}</button>`).join('')}</div><label class="sw-search" for="work-search">작품·교육 과정 검색<input type="search" id="work-search" placeholder="예: 공예, HUG, 숏폼" autocomplete="off"></label></div>
<p class="sw-count" id="work-count" role="status" aria-live="polite">등록된 작품 ${works.length}개 · 이미지 ${works.reduce((n,w)=>n+w.images.length,0)}장</p>
<div class="sw-grid">${works.map(w=>card(w)).join('\n')}</div>
<div class="sw-empty" id="work-empty" hidden><p>조건에 맞는 작품이 없습니다.<br>다른 검색어를 입력하거나 전체 작품을 살펴보세요.</p><button type="button" class="btn btn-ghost" data-reset>전체 작품 보기</button></div>
<aside class="sw-cta"><div><h2>우리 교육에서는 무엇을 만들까요?</h2><p>교육 대상과 주제를 알려주세요. 수업에서 만들 결과물부터 함께 정합니다.</p></div><a class="btn btn-primary" href="/lecture-request/?utm_source=student_works&amp;utm_medium=gallery&amp;utm_campaign=always_on" data-education-topic="institution" data-education-action="student_works">우리 기관 교육 문의 →</a></aside>
</div></section></main>
<dialog class="sw-dialog" id="work-dialog" aria-labelledby="work-dialog-title"><div class="sw-dialog-head"><h2 id="work-dialog-title">작품 크게 보기</h2><button type="button" class="sw-close" data-close aria-label="작품 미리보기 닫기">닫기</button></div><div class="sw-dialog-content" data-dialog-content></div></dialog>
<footer class="sw-footer"><div class="inner"><span>© BCC 비즈니스커리어컨설팅 · 오예림</span><a class="link" href="/cases/">교육 사례 더 보기 →</a></div></footer>
</body></html>
`;
writeFileSync(new URL('../student-works/index.html', import.meta.url), html);
const homeUrl = new URL('../index.html', import.meta.url);
let home = readFileSync(homeUrl, 'utf8');
const section = `<!-- STUDENT_WORKS:START -->
<section class="sw-section" id="student-works" aria-labelledby="sw-title"><div class="inner">
<div class="sw-head"><div><p class="eyebrow">교육생 작품</p><h2 id="sw-title">수업에서 직접 만든 작품을 만나보세요.</h2><p>홈페이지, 홍보 콘텐츠, 영상 기획과 슬라이드.<br>내 주제로 만든 결과물을 한곳에 모았습니다.</p></div><div class="works-destinations"><a class="link" href="/student-works/">등록된 작품 ${works.length}개 모두 보기 →</a><a href="/portfolio/">수업·강사 결과물 보기 →</a></div></div>
<div class="sw-grid sw-home-grid">${works.filter(w=>w.featured).map(w=>card(w,true)).join('\n')}</div>
</div></section>
<!-- STUDENT_WORKS:END -->`;
if (home.includes('<!-- STUDENT_WORKS:START -->')) home = home.replace(/<!-- STUDENT_WORKS:START -->[\s\S]*?<!-- STUDENT_WORKS:END -->/,section);
else home = home.replace('<!-- 4. 후기 벽 -->',section+'\n\n<!-- 4. 후기 벽 -->');
if (!home.includes('href="/assets/student-works.css')) home = home.replace('</head>','<link rel="stylesheet" href="/assets/student-works.css?v=20261117a">\n</head>');
writeFileSync(homeUrl,home);
console.log(`Generated ${works.length} works, ${works.filter(w=>w.featured).length} featured`);
