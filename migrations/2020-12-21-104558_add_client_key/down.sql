-- alter table users drop column client_key;
pragma foreign_keys=off;
begin transaction;
create table users2 (
    id integer primary key autoincrement,
    name varchar not null unique collate nocase,
    password varchar not null,
    secret_key varchar not null,
    tokens int not null default 0
);
insert into users2(id, name, password, secret_key, tokens)
select id, name, password, secret_key, tokens  from users;
drop table users;
alter table users2 rename to users;
commit;
pragma foreign_keys=on;
