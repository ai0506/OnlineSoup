"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";

import {
  IconBook,
  IconCoins,
  IconDoor,
  IconHome,
  IconLogIn,
  IconMessage,
  IconPlusSquare,
  IconUser,
} from "@/components/icons";
import { LogoutButton } from "@/components/logout-button";

const OPEN_DELAY = 100;
const CLOSE_DELAY = 80;
const ACCOUNT_CLOSE_DELAY = 600;
const ACCOUNT_KEY = "account";

type NavItemProps = {
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  newTab?: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
};

function NavItem({
  href,
  icon: Icon,
  label,
  newTab,
  open,
  onOpen,
  onClose,
}: NavItemProps) {
  return (
    <div
      className="nav-item"
      onBlur={onClose}
      onFocus={onOpen}
      onMouseEnter={onOpen}
      onMouseLeave={onClose}
    >
      <Link
        aria-label={label}
        className="nav-icon"
        href={href}
        rel={newTab ? "noopener" : undefined}
        target={newTab ? "_blank" : undefined}
      >
        <Icon />
      </Link>
      <span className="nav-pop" data-open={open || undefined} role="presentation">
        {label}
      </span>
    </div>
  );
}

type SiteNavProps = {
  signedIn: boolean;
  username: string | null;
  points: number | null;
  activeRoomCode: string | null;
};

export function SiteNav({
  signedIn,
  username,
  points,
  activeRoomCode,
}: SiteNavProps) {
  // 同一时间只允许一个展开层，新的展开会顶掉旧的
  const [openKey, setOpenKey] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accountRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // 仅键盘/点击打开时接管焦点，悬停打开不抢焦点
  const focusMenu = useRef(false);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    if (openKey !== ACCOUNT_KEY) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenKey(null);
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) {
        setOpenKey(null);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [openKey]);

  const accountOpen = openKey === ACCOUNT_KEY;

  useEffect(() => {
    if (!focusMenu.current) return;
    if (accountOpen) {
      accountRef.current
        ?.querySelector<HTMLElement>(".nav-pop-item")
        ?.focus();
    } else {
      triggerRef.current?.focus();
      focusMenu.current = false;
    }
  }, [accountOpen]);

  const schedule = useCallback((run: () => void, delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(run, delay);
  }, []);

  const openItem = useCallback(
    (key: string, delay = OPEN_DELAY) => {
      schedule(() => setOpenKey(key), delay);
    },
    [schedule],
  );

  // 只关自己，避免离开旧项时误关刚展开的新项
  const closeItem = useCallback(
    (key: string, delay = CLOSE_DELAY) => {
      schedule(() => setOpenKey((prev) => (prev === key ? null : prev)), delay);
    },
    [schedule],
  );

  const item = (
    key: string,
    href: string,
    icon: ComponentType<{ className?: string }>,
    label: string,
    newTab?: boolean,
  ) => (
    <NavItem
      href={href}
      icon={icon}
      key={key}
      label={label}
      newTab={newTab}
      onClose={() => closeItem(key)}
      onOpen={() => openItem(key)}
      open={openKey === key}
    />
  );

  let account: ReactNode;
  if (!signedIn) {
    account = item("login", "/login", IconLogIn, "登录");
  } else if (!username) {
    account = item("username", "/account/username", IconUser, "设置用户名");
  } else {
    account = (
      <div
        className="nav-item nav-account"
        onMouseEnter={() => openItem(ACCOUNT_KEY)}
        onMouseLeave={() => closeItem(ACCOUNT_KEY, ACCOUNT_CLOSE_DELAY)}
        ref={accountRef}
      >
        <button
          aria-expanded={accountOpen}
          aria-haspopup="true"
          className="link-button nav-icon nav-icon-labeled"
          onClick={() => {
            focusMenu.current = !accountOpen;
            if (accountOpen) {
              setOpenKey(null);
            } else {
              openItem(ACCOUNT_KEY, 0);
            }
          }}
          ref={triggerRef}
          type="button"
        >
          <IconUser />
          <span>{username}</span>
        </button>
        <div className="nav-pop nav-pop-menu" data-open={accountOpen || undefined}>
          <p className="nav-pop-head">
            {username}
            {points !== null && (
              <span className="nav-pop-points">{points} 积分</span>
            )}
          </p>
          <Link className="nav-pop-item" href="/profile">
            个人资料
          </Link>
          <Link className="nav-pop-item" href="/points-history">
            积分流水
          </Link>
          <LogoutButton className="nav-pop-item nav-pop-danger" />
        </div>
      </div>
    );
  }

  return (
    <nav>
      {item("home", "/", IconHome, "大厅")}
      {item("tutorial", "/tutorial", IconBook, "教程")}
      {signedIn &&
        (activeRoomCode
          ? item(
              "active-room",
              `/rooms/${activeRoomCode}`,
              IconDoor,
              `返回房间 ${activeRoomCode}`,
            )
          : item("new-room", "/rooms/new", IconPlusSquare, "创建房间"))}
      {/* 单独新标签打开，避免打断正在进行的房间 */}
      {signedIn && item("feedback", "/feedback", IconMessage, "反馈", true)}
      <span aria-hidden="true" className="nav-sep" />
      {signedIn && points !== null && (
        <span className="user-points">
          <IconCoins />
          <span>{points}</span>
        </span>
      )}
      {account}
    </nav>
  );
}
