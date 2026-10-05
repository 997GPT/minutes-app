-- ============================================================
--  نظام محاضر الاجتماعات — قاعدة البيانات (Supabase / PostgreSQL)
--  الصق هذا الملف كاملاً في: Supabase ▸ SQL Editor ▸ Run
--  يمكن تشغيله أكثر من مرة بأمان.
-- ============================================================

-- ---------- الجداول ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  employee_no text not null unique,
  name        text not null,
  email       text not null,
  phone       text not null,
  role        text not null default 'user' check (role in ('admin', 'user')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.settings (
  id   int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb
);
insert into public.settings (id, data) values (1, '{}'::jsonb) on conflict (id) do nothing;

-- إعدادات الذكاء الاصطناعي (مفتاح API) — لا يقرؤها إلا مدير النظام والخادم
create table if not exists public.secrets (
  id int primary key default 1 check (id = 1),
  ai jsonb not null default '{}'::jsonb
);
insert into public.secrets (id, ai) values (1, '{}'::jsonb) on conflict (id) do nothing;

create table if not exists public.minutes (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title        text not null default '',
  meeting_date date,
  data         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists minutes_owner_idx on public.minutes (owner, meeting_date desc);

-- ---------- دوال مساعدة ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and active);
$$;

create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;

-- الدخول بالرقم الوظيفي: إرجاع البريد المرتبط بالرقم الوظيفي
create or replace function public.login_email(emp text) returns text
language sql stable security definer set search_path = public as $$
  select email from public.profiles where employee_no = btrim(emp) limit 1;
$$;

-- تعديل المستخدم لبياناته الشخصية (الاسم ورقم التواصل فقط)
create or replace function public.update_my_profile(p_name text, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(btrim(p_name), '') = '' or coalesce(btrim(p_phone), '') = '' then
    raise exception 'الاسم ورقم التواصل مطلوبان';
  end if;
  update public.profiles set name = btrim(p_name), phone = btrim(p_phone) where id = auth.uid();
end;
$$;

-- إنشاء الملف الشخصي تلقائياً عند تسجيل مستخدم جديد.
-- أول مستخدم يسجل في النظام يصبح مدير النظام.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_emp   text := btrim(coalesce(new.raw_user_meta_data ->> 'employee_no', ''));
  v_name  text := btrim(coalesce(new.raw_user_meta_data ->> 'name', ''));
  v_phone text := btrim(coalesce(new.raw_user_meta_data ->> 'phone', ''));
begin
  if v_emp = '' or v_name = '' or v_phone = '' then
    raise exception 'الرقم الوظيفي والاسم ورقم التواصل مطلوبة';
  end if;
  insert into public.profiles (id, employee_no, name, email, phone, role)
  values (
    new.id, v_emp, v_name, new.email, v_phone,
    case when exists (select 1 from public.profiles where role = 'admin') then 'user' else 'admin' end
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists minutes_touch on public.minutes;
create trigger minutes_touch before update on public.minutes
  for each row execute function public.touch_updated_at();

-- ---------- الصلاحيات (Row Level Security) ----------
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.secrets  enable row level security;
alter table public.minutes  enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to anon, authenticated using (true);

drop policy if exists settings_admin_update on public.settings;
create policy settings_admin_update on public.settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists secrets_admin_select on public.secrets;
create policy secrets_admin_select on public.secrets for select to authenticated using (public.is_admin());

drop policy if exists secrets_admin_update on public.secrets;
create policy secrets_admin_update on public.secrets for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists minutes_all on public.minutes;
create policy minutes_all on public.minutes for all to authenticated
  using ((owner = auth.uid() and public.is_active()) or public.is_admin())
  with check ((owner = auth.uid() and public.is_active()) or public.is_admin());

-- ---------- منح الوصول عبر واجهة البيانات ----------
grant usage on schema public to anon, authenticated;
grant select on public.settings to anon, authenticated;
grant update on public.settings to authenticated;
grant select, update on public.profiles to authenticated;
grant select, update on public.secrets to authenticated;
grant select, insert, update, delete on public.minutes to authenticated;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.login_email(text) to anon, authenticated;
grant execute on function public.update_my_profile(text, text) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_active() to authenticated;
