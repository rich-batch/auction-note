---
# 물건 분석 글 front matter 모양. 실제 글은 analyze-case 스킬이 쓴다: content/analysis/<사건 ID>/index.md
# case는 data/cases/<사건 ID>.json 파일 이름과 같아야 한다(표를 그 데이터로 그림).
title: ""
author: "rich-batch"
date: {{ .Date | time.Format "2006-01-02" }}
lastmod: {{ .Date | time.Format "2006-01-02" }}
draft: true
case: "{{ .File.ContentBaseName }}"
categories: ["권리분석·명도"]
tags: []
description: ""
showToc: true
TocOpen: false
---
