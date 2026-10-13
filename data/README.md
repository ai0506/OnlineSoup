# 本地数据快照

这里保存从题库整理或导出的本地快照，不是应用运行时数据库。

- `puzzle-exports/`：不同时间导出的题目 JSON/TXT 文件，用于导入、比对和恢复参考。
- 线上 Supabase 数据仍以实际数据库为准，不能把这些快照当作完整备份。

## 搁置题目（2026-10-13）

线上 #15–#19（Emails I can send、怀孕的哥哥、消失的她、绝望的题目、餐厅自杀）保留为未启用草稿，不启用、不删除。线上只剩标题、汤面和汤底；评分点、examples 和难度见：

- `puzzle-exports/puzzles-2026-08-06-full.json`：08-06 完整导出。其中 4 题汤面/汤底与线上一致；邮件题当时名为“回到我手里的邮件”，之后汤底已重写，旧评分点和 examples 仅作参考。examples 含已废弃的 `boundary_type` 字段。
- `puzzle-exports/puzzles-2026-09-19-recovered-snapshots.json`：2026-09-19 误删后从 AI 错误案例快照恢复的标题/汤面/汤底。
- `puzzle-exports/puzzles-2026-09-19-inactive-drafts.json`：恢复为草稿后的线上记录备份（文件首字符为多余的 `+`，解析前需去掉）。
