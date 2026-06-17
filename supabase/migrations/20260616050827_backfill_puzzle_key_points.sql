-- Backfill puzzle scoring points from questions.json without touching puzzle text or examples.
update public.puzzles
set key_points = '[{"id":1,"text":"男人曾遭遇海难，被困荒岛","accept":["海难","荒岛","船难","遇难","漂流"]},{"id":2,"text":"在荒岛上吃掉了同伴的肉","accept":["吃人肉","吃同伴","食人","吃人"]},{"id":3,"text":"当时被告知吃的是海龟汤","accept":["被欺骗","以为是海龟","被骗"]},{"id":4,"text":"在餐厅喝到真正的海龟汤后发现味道不同","accept":["味道不同","发现真相","意识到"]}]'::jsonb
where id = 1;

update public.puzzles
set key_points = '[{"id":1,"text":"爸爸在意外中去世","accept":["去世","死亡","死了","意外"]},{"id":2,"text":"足球是用爸爸的头做成的","accept":["头","头骨","人头"]}]'::jsonb
where id = 2;

update public.puzzles
set key_points = '[{"id":1,"text":"男人身材矮小（侏儒）","accept":["矮","侏儒","够不到","太矮"]},{"id":2,"text":"够不到10楼的按钮","accept":["按不到","够不着","按钮太高"]},{"id":3,"text":"下雨天可以用雨伞按按钮","accept":["雨伞","下雨"]},{"id":4,"text":"有人时可以请别人帮忙","accept":["帮忙","别人按","其他人"]}]'::jsonb
where id = 3;

update public.puzzles
set key_points = '[{"id":1,"text":"我们是三角函数","accept":["sin，cos，tan，数学"]},{"id":2,"text":"cosplay","accept":["角色扮演，cosplay"]}]'::jsonb
where id = 4;

update public.puzzles
set key_points = '[{"id":1,"text":"李盎","accept":["打错字"]}]'::jsonb
where id = 5;

update public.puzzles
set key_points = '[{"id":1,"text":"\"太阳之子\"是公鸡","accept":["鸡"]},{"id":2,"text":"打鸣","accept":["叫"]},{"id":3,"text":"开心地杀了时因为吃了鸡","accept":["杀鸡，吃鸡"]}]'::jsonb
where id = 6;

update public.puzzles
set key_points = '[{"id":1,"text":"死者是鱼","accept":["不是人"]},{"id":2,"text":"玻璃碎片是鱼缸打破了","accept":["玻璃破了"]},{"id":3,"text":"缺水死亡","accept":["任意鱼缺水死亡的描述"]}]'::jsonb
where id = 7;

update public.puzzles
set key_points = '[{"id":1,"text":"任意三次项","accept":["ax^3 (a≠0)"]},{"id":2,"text":"三次项系数为1","accept":["f(x)=...x^3..."]},{"id":3,"text":"任意二次项","accept":["bx^2 (b≠0)"]},{"id":4,"text":"三次项系数为-1","accept":["f(x)=...-x^2..."]}]'::jsonb
where id = 8;

update public.puzzles
set key_points = '[{"id":1,"text":"体育课","accept":["户外的课，假期"]}]'::jsonb
where id = 9;

notify pgrst, 'reload schema';
