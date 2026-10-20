#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""异环 · 都市手账 — data.js 编辑器

两种用法（同一份核心逻辑）：

  图形界面（需要 tkinter）
      python data_editor.py
      python data_editor.py nte-companion/assets/data.js

  命令行（无 tkinter 也能用，适合批量改）
      python data_editor.py list
      python data_editor.py list --cat daily
      python data_editor.py add --cat daily --title "新任务" --step "第一步" --step "第二步"
      python data_editor.py edit 42 --title "改个名字" --cat weekly --step "唯一一步"
      python data_editor.py edit 42 --clear-steps
      python data_editor.py rm 42 43
      python data_editor.py move 42 up
      python data_editor.py cat            # 列出分类
      python data_editor.py check          # 只校验不写盘

任何写盘动作都会先把原文件备份到 .backup/data-<时间戳>/data.js
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import re
import shutil
import sys
import unicodedata

APP_TITLE = "异环 · 都市手账 — 数据编辑器"
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DATA = os.path.join(HERE, "nte-companion", "assets", "data.js")
BACKUP_ROOT = os.path.join(HERE, ".backup")

# 特殊任务在分组注释里标注自定义重置，避免和固定周期混淆
GROUP_SUFFIX = {"special": "（自定义：开始时间 + 重置间隔，按周期往后数）"}

try:  # tkinter 属于可选依赖，缺了就走命令行
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk

    HAS_TK = True
except Exception:  # pragma: no cover
    HAS_TK = False


# --------------------------------------------------------------------------
# 一、JS 对象解析（data.js 不是标准 JSON：裸键、注释、尾逗号）
# --------------------------------------------------------------------------
class JsParseError(Exception):
    pass


class _Parser:
    _LITERALS = (("true", True), ("false", False), ("null", None), ("undefined", None))
    _NUM = re.compile(r"-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?")
    _KEY = re.compile(r"[A-Za-z_$][\w$]*")
    _ESC = {"n": "\n", "r": "\r", "t": "\t", "b": "\b", "f": "\f", "v": "\v", "0": "\0"}

    def __init__(self, text: str, pos: int = 0):
        self.s = text
        self.i = pos
        self.n = len(text)

    # -- 跳过空白与注释 --
    def skip(self) -> None:
        while self.i < self.n:
            c = self.s[self.i]
            if c in " \t\r\n\ufeff":
                self.i += 1
            elif c == "/" and self.s.startswith("//", self.i):
                j = self.s.find("\n", self.i)
                self.i = self.n if j < 0 else j + 1
            elif c == "/" and self.s.startswith("/*", self.i):
                j = self.s.find("*/", self.i + 2)
                if j < 0:
                    raise JsParseError("块注释没有闭合")
                self.i = j + 2
            else:
                return

    def parse_value(self):
        self.skip()
        if self.i >= self.n:
            raise JsParseError("内容意外结束")
        c = self.s[self.i]
        if c == "{":
            return self.parse_object()
        if c == "[":
            return self.parse_array()
        if c in "\"'":
            return self.parse_string()
        for lit, val in self._LITERALS:
            if self.s.startswith(lit, self.i):
                self.i += len(lit)
                return val
        m = self._NUM.match(self.s, self.i)
        if m:
            self.i = m.end()
            txt = m.group(0)
            return float(txt) if ("." in txt or "e" in txt.lower()) else int(txt)
        raise JsParseError("无法识别的内容：%r" % self.s[self.i : self.i + 20])

    def parse_object(self) -> dict:
        self.i += 1  # 吃掉 {
        obj: dict = {}
        while True:
            self.skip()
            if self.i >= self.n:
                raise JsParseError("{ 没有闭合")
            if self.s[self.i] == "}":
                self.i += 1
                return obj
            if self.s[self.i] in "\"'":
                key = self.parse_string()
            else:
                m = self._KEY.match(self.s, self.i)
                if not m:
                    raise JsParseError("对象键名不合法：%r" % self.s[self.i : self.i + 20])
                key = m.group(0)
                self.i = m.end()
            self.skip()
            if self.i >= self.n or self.s[self.i] != ":":
                raise JsParseError("键 %r 后面缺少冒号" % key)
            self.i += 1
            obj[key] = self.parse_value()
            self.skip()
            if self.i < self.n and self.s[self.i] == ",":
                self.i += 1  # 尾逗号由下一轮循环的 } 兜住
            elif self.i < self.n and self.s[self.i] == "}":
                continue
            else:
                raise JsParseError("对象里缺少逗号或右花括号")

    def parse_array(self) -> list:
        self.i += 1  # 吃掉 [
        arr: list = []
        while True:
            self.skip()
            if self.i >= self.n:
                raise JsParseError("[ 没有闭合")
            if self.s[self.i] == "]":
                self.i += 1
                return arr
            arr.append(self.parse_value())
            self.skip()
            if self.i < self.n and self.s[self.i] == ",":
                self.i += 1
            elif self.i < self.n and self.s[self.i] == "]":
                continue
            else:
                raise JsParseError("数组里缺少逗号或右方括号")

    def parse_string(self) -> str:
        quote = self.s[self.i]
        self.i += 1
        out = []
        while self.i < self.n:
            c = self.s[self.i]
            if c == quote:
                self.i += 1
                return "".join(out)
            if c == "\\":
                self.i += 1
                if self.i >= self.n:
                    break
                e = self.s[self.i]
                if e == "u":
                    hexs = self.s[self.i + 1 : self.i + 5]
                    if len(hexs) < 4:
                        raise JsParseError("\\u 转义不完整")
                    out.append(chr(int(hexs, 16)))
                    self.i += 5
                    continue
                if e == "x":
                    hexs = self.s[self.i + 1 : self.i + 3]
                    if len(hexs) < 2:
                        raise JsParseError("\\x 转义不完整")
                    out.append(chr(int(hexs, 16)))
                    self.i += 3
                    continue
                out.append(self._ESC.get(e, e))
                self.i += 1
                continue
            out.append(c)
            self.i += 1
        raise JsParseError("字符串没有闭合")


_MARK = re.compile(r"window\.NTE_DATA\s*=\s*")


def parse_data(text: str):
    """返回 (数据字典, 前缀)。前缀是 window.NTE_DATA = 之前 + 等号本身，用于写回时保留头注释。"""
    m = _MARK.search(text)
    if not m:
        raise JsParseError("文件里没有找到 window.NTE_DATA = { ... }")
    parser = _Parser(text, m.end())
    data = parser.parse_value()
    if not isinstance(data, dict):
        raise JsParseError("window.NTE_DATA 应该是一个对象")
    return data, text[: m.end()]


# --------------------------------------------------------------------------
# 二、写回（还原手写的排版风格，未改动时逐字节一致）
# --------------------------------------------------------------------------
def _q(s) -> str:
    return json.dumps("" if s is None else str(s), ensure_ascii=False)


def _val(v) -> str:
    """分类额外字段的值：数字/布尔原样写，字符串带引号"""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return json.dumps(v)
    if v is None:
        return "null"
    return json.dumps(str(v), ensure_ascii=False)


def _dw(s: str) -> int:
    """按终端显示宽度计算（中文算 2 列），用来复现原文的对齐"""
    return sum(2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1 for ch in s)


def _pad(s: str, width: int) -> str:
    return s + " " * max(0, width - _dw(s))


_ISO = re.compile(r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{2}:?\d{2}|Z)?$")


def _parse_iso(text):
    """解析 startAt：返回不带时区的 datetime（按墙上时间理解），失败返回 None"""
    if not isinstance(text, str):
        return None
    m = _ISO.match(text.strip())
    if not m:
        return None
    y, mo, d, h, mi, sec = (int(x or 0) for x in m.groups()[:6])
    try:
        return _dt.datetime(y, mo, d, h, mi, sec)
    except ValueError:
        return None


def _as_int(value):
    """把 every 读成正整数，读不出来返回 None"""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, float) and value.is_integer():
        return int(value) if value > 0 else None
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip()) or None
    return None


def _as_num(value):
    """把 clock / earn / countStep 读成正数（可带小数），读不出来返回 None"""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if value > 0 else None
    if isinstance(value, str):
        try:
            f = float(value.strip())
        except ValueError:
            return None
        return f if f > 0 else None
    return None


def _num_text(value) -> str:
    """数字写回文本：整数不带小数点（8 而不是 8.0）"""
    v = float(value)
    return str(int(v)) if v.is_integer() else repr(v)


# 任务级的可选机制字段：后台填了才在页面上生效
MECH_KEYS = ("clock", "earn", "countStep")


def _fmt_iso(dt: "_dt.datetime", tz: str = "+08:00") -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:00") + tz


def _cycle_text(task: dict) -> str:
    """把 startAt + every 拼成一句中文说明"""
    dt = _parse_iso(task.get("startAt"))
    every = _as_int(task.get("every"))
    bits = []
    if dt:
        bits.append("自 %s 起" % dt.strftime("%Y-%m-%d %H:%M"))
    if every:
        bits.append("每 %d 天重置一次" % every)
    return "，".join(bits) or "未设置"


def _mech_text(task: dict) -> str:
    """可选机制的中文说明（没配置就返回空串）"""
    bits = []
    if task.get("minor"):
        bits.append("次要任务（排在已完成之后，不计入总次数）")
    clock = _as_num(task.get("clock"))
    if clock is not None:
        bits.append("完成 %s 小时后重置" % _num_text(clock))
    earn = _as_num(task.get("earn"))
    if earn is not None:
        bits.append("收益目标 %s" % _num_text(earn))
    step = _as_num(task.get("countStep"))
    if step is not None:
        bits.append("每完成一次 +%s" % _num_text(step))
    return "，".join(bits)


def _link_ids(task: dict) -> list:
    """读任务上的 link 字段，返回合法的 id 列表（写盘和校验之外只读用）"""
    raw = task.get("link")
    if not isinstance(raw, list):
        return []
    out = []
    for v in raw:
        n = _as_int(v)
        if n is not None and n > 0 and n not in out:
            out.append(n)
    return out


def _link_text(task: dict) -> str:
    ids = _link_ids(task)
    if not ids:
        return ""
    return "关联 " + "、".join("#%d" % n for n in ids)


def _parse_link(raw):
    """把 "12, 15" 解析成任务编号列表；返回 (ids, 出错片段)"""
    s = str(raw or "").strip()
    if not s or s.lower() in ("none", "off", "clear", "清空", "-"):
        return [], None
    ids = []
    for part in re.split(r"[,，、;；\s]+", s):
        part = part.strip().lstrip("#")
        if not part:
            continue
        n = _as_int(part)
        if n is None or n <= 0:
            return None, part
        if n not in ids:
            ids.append(n)
    return ids, None


def _cat_line(cat: dict, last: bool) -> str:
    key = _q(cat.get("key")) + ","
    label = _q(cat.get("label")) + ","
    icon = _q(cat.get("icon"))
    if cat.get("reset"):
        head = "    { key: %slabel: %sicon: %sreset: %s" % (
            _pad(key, 12),
            _pad(label, 14),
            _pad(icon + ",", 12),
            _q(cat.get("reset")),
        )
    else:
        head = "    { key: %slabel: %sicon: %s" % (_pad(key, 12), _pad(label, 14), icon)

    # 分类上的额外字段（版本名称等）能一行放下就接在后面，太长才折到第二行
    known = ("key", "label", "icon", "reset")
    extras = [(k, v) for k, v in cat.items() if k not in known]
    tail = " }" + ("" if last else ",")
    if not extras:
        return head + tail
    body = ", ".join("%s: %s" % (k, _val(v)) for k, v in extras)
    inline = head + ", " + body + tail
    if _dw(inline) <= 108:
        return inline
    return head + ",\n      " + body + tail


def _task_lines(task: dict, last: bool) -> list:
    steps = "[" + ", ".join(_q(s) for s in task.get("steps") or []) + "]"
    # 特殊任务的重置规则跟着任务本身走：startAt 开始时间 + every 间隔天数
    extra = ""
    # 次要任务：只写 true，关闭时字段直接删掉
    if task.get("minor") is True:
        extra += ", minor: true"
    if task.get("startAt"):
        extra += ", startAt: %s" % _q(task.get("startAt"))
    every = _as_int(task.get("every"))
    if every is not None:
        extra += ", every: %d" % every
    # 可选机制：完成后计时 / 收益目标 / 每次完成计数
    for key in MECH_KEYS:
        v = _as_num(task.get(key))
        if v is not None:
            extra += ", %s: %s" % (key, _num_text(v))
    # 关联任务：主任务列出从属任务编号
    kids = _link_ids(task)
    if kids:
        extra += ", link: [%s]" % ", ".join(str(k) for k in kids)
    head = '    { id: %s, cat: %s, title: %s%s,' % (
        task.get("id"),
        _q(task.get("cat")),
        _q(task.get("title")),
        extra,
    )
    tail = "      steps: %s }" % steps
    if not last:
        tail += ","
    return [head, tail]


def dump_data(data: dict, prefix: str) -> str:
    cats = list(data.get("categories") or [])
    tasks = list(data.get("tasks") or [])
    lines = [prefix + "{"]

    lines.append("  categories: [")
    for i, cat in enumerate(cats):
        lines.append(_cat_line(cat, last=(i == len(cats) - 1)))
    lines.append("  ],")
    lines.append("")

    lines.append("  tasks: [")

    # 按分类顺序分组；分类字段缺失或未知的任务统一排到最后的「其他」
    order = [c.get("key") for c in cats if c.get("key")]
    label_of = {c.get("key"): c.get("label") or c.get("key") for c in cats}
    groups: list = [(k, label_of.get(k, k)) for k in order]
    known = set(order)
    extra = [t for t in tasks if t.get("cat") not in known]
    if extra:
        groups.append(("__other__", "其他"))

    buckets = {k: [] for k, _ in groups}
    for t in tasks:
        key = t.get("cat") if t.get("cat") in buckets else "__other__"
        buckets[key].append(t)

    first_group = True
    total_left = len(tasks)
    for key, label in groups:
        items = buckets.get(key) or []
        if not items:
            continue
        if not first_group:
            lines.append("")
        first_group = False
        title = str(label) + GROUP_SUFFIX.get(key, "")
        lines.append("    /* ---------------- %s ---------------- */" % title)
        for t in items:
            total_left -= 1
            lines.extend(_task_lines(t, last=(total_left == 0)))

    lines.append("  ]")
    lines.append("};")
    return "\n".join(lines) + "\n"


# --------------------------------------------------------------------------
# 三、文件读写 + 备份
# --------------------------------------------------------------------------
class DataFile:
    def __init__(self, path: str):
        self.path = os.path.abspath(path)
        self.data: dict = {}
        self.prefix = ""
        self.newline = "\n"
        self.reload()

    # -- 读取 --
    def reload(self) -> None:
        if not os.path.exists(self.path):
            raise FileNotFoundError("找不到文件：%s" % self.path)
        with open(self.path, "r", encoding="utf-8", newline="") as f:
            raw = f.read()
        # 记住原文件的换行风格（手写版是 CRLF），写回时保持一致
        self.newline = "\r\n" if "\r\n" in raw else "\n"
        self.data, self.prefix = parse_data(raw.replace("\r\n", "\n"))
        self.data.setdefault("categories", [])
        self.data.setdefault("tasks", [])

    @property
    def cats(self) -> list:
        return self.data["categories"]

    @property
    def tasks(self) -> list:
        return self.data["tasks"]

    def task_cats(self) -> list:
        """可用于任务的分类（排除 all 这种汇总项，它没有 reset 字段）"""
        return [c for c in self.cats if c.get("key") != "all"]

    def label_of(self, key) -> str:
        for c in self.cats:
            if c.get("key") == key:
                return c.get("label") or key
        return str(key)

    def key_of_label(self, label) -> str:
        for c in self.cats:
            if (c.get("label") or c.get("key")) == label:
                return c.get("key")
        return label

    # -- 任务操作 --
    def find(self, tid: int):
        for t in self.tasks:
            if int(t.get("id", -1)) == int(tid):
                return t
        return None

    def next_id(self) -> int:
        return max([int(t.get("id", 0)) for t in self.tasks], default=0) + 1

    def sort_tasks(self) -> None:
        """按分类顺序稳定排序，同分类内保持原有先后"""
        order = {c.get("key"): i for i, c in enumerate(self.cats)}
        self.tasks.sort(key=lambda t: order.get(t.get("cat"), len(order)))

    def add(self, cat: str, title: str, steps=None) -> dict:
        task = {"id": self.next_id(), "cat": cat, "title": title, "steps": list(steps or [])}
        # 插到该分类最后一条之后，保证新任务排在本组末尾而不是最前面
        at = len(self.tasks)
        for i in range(len(self.tasks) - 1, -1, -1):
            if self.tasks[i].get("cat") == cat:
                at = i + 1
                break
        self.tasks.insert(at, task)
        self.sort_tasks()
        return task

    def set_cat(self, task: dict, cat: str) -> None:
        """改分类时把任务挪到新分类的末尾（直接改字段会按旧位置插到组首）"""
        if task.get("cat") == cat:
            return
        self.data["tasks"] = [t for t in self.tasks if t is not task]
        task["cat"] = cat
        self.tasks.append(task)
        self.sort_tasks()

    def remove(self, tid: int) -> bool:
        before = len(self.tasks)
        self.data["tasks"] = [t for t in self.tasks if int(t.get("id", -1)) != int(tid)]
        gone = len(self.data["tasks"]) != before
        # 删掉的正好是版本卡跟随的任务时，改回「跟随最近的重置」，避免留下悬空引用
        if gone and self.card_task() == int(tid):
            self.set_card_task(None)
        return gone

    def move(self, tid: int, delta: int) -> bool:
        """在同一分类内部上移 / 下移一位"""
        self.sort_tasks()
        task = self.find(tid)
        if task is None:
            return False
        same = [i for i, t in enumerate(self.tasks) if t.get("cat") == task.get("cat")]
        pos = same.index(self.tasks.index(task))
        target = pos + delta
        if not 0 <= target < len(same):
            return False
        a, b = self.tasks.index(task), same[target]
        self.tasks[a], self.tasks[b] = self.tasks[b], self.tasks[a]
        return True

    def can_move(self, tid: int, delta: int) -> bool:
        """能否继续朝这个方向移动（不实际改动）"""
        task = self.find(tid)
        if task is None:
            return False
        same = [t for t in self.tasks if t.get("cat") == task.get("cat")]
        pos = same.index(task)
        return 0 <= pos + delta < len(same)

    def renumber(self, start: int = 1) -> dict:
        """按当前顺序（分类顺序 + 组内先后）把 id 重排为 start..N

        返回发生变化的 {旧编号: 新编号}；顺序本身不变。
        """
        self.sort_tasks()
        changed = {}
        for i, t in enumerate(self.tasks):
            old = int(t.get("id", 0))
            new = start + i
            if old != new:
                changed[old] = new
            t["id"] = new
        # 版本卡绑定的编号跟着一起改，不然重编号后会指向不存在的任务
        cid = self.card_task()
        if cid is not None and cid in changed:
            self.set_card_task(changed[cid])
        return changed

    # -- 特殊任务 / 版本信息 --
    def special_cat(self):
        """返回使用自定义重置时间的分类（没有就返回 None）"""
        for c in self.cats:
            if c.get("reset") == "custom":
                return c
        return None

    def set_version(self, name: str) -> dict:
        """写入版本名称；重置规则不放在分类上"""
        cat = self.special_cat()
        if cat is None:
            raise ValueError("没有找到 reset 为 custom 的分类")
        cat["version"] = name
        cat.pop("resetAt", None)
        return cat

    def special_tasks(self) -> list:
        cat = self.special_cat()
        if cat is None:
            return []
        return [t for t in self.tasks if t.get("cat") == cat.get("key")]

    def card_task(self):
        """版本卡固定跟随的特殊任务 id；没设置返回 None（跟随最近的重置）"""
        cat = self.special_cat()
        if cat is None:
            return None
        return _as_int(cat.get("cardTask"))

    def set_card_task(self, tid) -> dict:
        """设置版本卡绑定的任务编号；传 None 表示改回「跟随最近的重置」"""
        cat = self.special_cat()
        if cat is None:
            raise ValueError("没有找到 reset 为 custom 的分类")
        if tid is None:
            cat.pop("cardTask", None)
        else:
            cat["cardTask"] = int(tid)
        return cat

    def set_special_cycle(self, start=None, every=None, tids=None) -> int:
        """给特殊任务写开始时间 / 重置间隔（传 None 表示不改），返回改动条数"""
        target = self.special_tasks()
        if tids is not None:
            target = [t for t in target if _as_int(t.get("id")) in tids]
        for t in target:
            if start is not None:
                t["startAt"] = start
            if every is not None:
                t["every"] = int(every)
        return len(target)

    def cycles(self) -> list:
        """特殊任务里出现过的（开始时间, 间隔天数），按开始时间升序去重"""
        seen = {}
        for t in self.special_tasks():
            start = t.get("startAt") or ""
            every = _as_int(t.get("every"))
            if not start and every is None:
                continue
            seen.setdefault((start, every), []).append(t.get("id"))
        return sorted(seen.items(), key=lambda kv: _parse_iso(kv[0][0]) or _dt.datetime.min)

    # -- 校验 --
    def validate(self) -> list:
        errors = []
        ids, titles = set(), {}
        for i, t in enumerate(self.tasks, 1):
            tid = t.get("id")
            if not isinstance(tid, int) or tid <= 0:
                errors.append("第 %d 条任务的 id 不合法：%r" % (i, tid))
                continue
            if tid in ids:
                errors.append("id 重复：%d" % tid)
            ids.add(tid)
            title = (t.get("title") or "").strip()
            if not title:
                errors.append("id %d 的任务标题为空" % tid)
            elif title in titles:
                errors.append("标题重复：%s（id %d 与 %d）" % (title, titles[title], tid))
            else:
                titles[title] = tid
            if t.get("cat") not in {c.get("key") for c in self.task_cats()}:
                errors.append("id %d 的分类不在分类表里：%r" % (tid, t.get("cat")))
            steps = t.get("steps")
            if steps is not None and not isinstance(steps, list):
                errors.append("id %d 的 steps 应该是数组" % tid)
            elif isinstance(steps, list):
                for s in steps:
                    if not isinstance(s, str):
                        errors.append("id %d 的步骤里有非字符串项" % tid)
                        break
            at = t.get("startAt")
            if at not in (None, ""):
                if not _parse_iso(at):
                    errors.append("id %d 的 startAt 无法解析：%r" % (tid, at))
            every = t.get("every")
            if every not in (None, "") and _as_int(every) is None:
                errors.append("id %d 的 every 应该是正整数天数：%r" % (tid, every))
            for key in MECH_KEYS:
                v = t.get(key)
                if v not in (None, "") and _as_num(v) is None:
                    errors.append("id %d 的 %s 应该是正数：%r" % (tid, key, v))
        # 关联任务：link 只能指向存在的任务，不能自关联 / 重复 / 组套组 / 一个任务两个主任务
        claimers = {t.get("id") for t in self.tasks if _link_ids(t)}
        owned = {}
        for t in self.tasks:
            tid = t.get("id")
            raw = t.get("link")
            if raw is None:
                continue
            if not isinstance(raw, list):
                errors.append("id %s 的 link 应该是编号数组，例如 [7, 13]" % tid)
                continue
            seen = set()
            for v in raw:
                n = _as_int(v)
                if n is None or n <= 0:
                    errors.append("id %s 的 link 里不是任务编号：%r" % (tid, v))
                    continue
                if n == tid:
                    errors.append("id %s 的 link 不能包含自己" % tid)
                    continue
                if n not in ids:
                    errors.append("id %s 关联的任务 id=%d 不存在" % (tid, n))
                    continue
                if n in seen:
                    errors.append("id %s 的 link 里重复写了 id=%d" % (tid, n))
                    continue
                seen.add(n)
                if n in owned:
                    errors.append("id %d 同时被 id %s 和 id %s 关联，一个任务只能有一个主任务"
                                  % (n, owned[n], tid))
                    continue
                owned[n] = tid
                if n in claimers:
                    errors.append("id %d 自己也有 link，关联不能套娃" % n)
            if tid in owned:
                errors.append("id %s 已经被 id %s 关联，自己不能再当主任务" % (tid, owned[tid]))

        cat = self.special_cat()
        if cat is not None and cat.get("cardTask") not in (None, ""):
            cid = _as_int(cat.get("cardTask"))
            if cid is None:
                errors.append("cardTask 不是任务编号：%r" % cat.get("cardTask"))
            elif cid not in ids:
                errors.append("cardTask 绑定的任务 id=%d 不存在" % cid)
            elif cid not in {t.get("id") for t in self.special_tasks()}:
                errors.append("cardTask 绑定的任务 id=%d 不在特殊分类里" % cid)
        return errors

    # -- 写回 --
    def backup(self) -> str:
        stamp = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        # 项目内的文件统一备份到项目根的 .backup；外部文件备份到它自己旁边的 .backup
        root = BACKUP_ROOT
        if not self.path.lower().startswith(HERE.lower() + os.sep):
            root = os.path.join(os.path.dirname(self.path), ".backup")
        folder = os.path.join(root, "data-" + stamp)
        n = 1
        while os.path.exists(folder):  # 同一秒内连续保存也不会覆盖上一次备份
            n += 1
            folder = os.path.join(root, "data-%s-%d" % (stamp, n))
        os.makedirs(folder, exist_ok=True)
        dest = os.path.join(folder, "data.js")
        shutil.copy2(self.path, dest)
        return dest

    def save(self) -> str:
        errors = self.validate()
        if errors:
            raise ValueError("数据有问题，没有写入：\n" + "\n".join(errors))
        self.sort_tasks()
        text = dump_data(self.data, self.prefix)
        if self.newline != "\n":
            text = text.replace("\n", self.newline)
        backup_path = self.backup() if os.path.exists(self.path) else ""
        # 先写临时文件再原子替换，避免写到一半断电留下半截 data.js
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8", newline="") as f:
            f.write(text)
        os.replace(tmp, self.path)
        return backup_path


# --------------------------------------------------------------------------
# 四、命令行
# --------------------------------------------------------------------------
HELP = """用法：
  python data_editor.py                      打开图形界面
  python data_editor.py --file 路径           指定要编辑的 data.js
  python data_editor.py list [--cat 分类] [--grep 关键字]
  python data_editor.py cat                  列出分类与特殊任务的重置规则
  python data_editor.py add --cat daily --title "标题" [--step "一步" --step "二步"] [--start-at "2026-10-05 05:00"] [--every 7] [--clock 8] [--earn 30000] [--count-step 1] [--link 7,13]
  python data_editor.py edit ID [--cat 分类] [--title "标题"] [--step ...] [--clear-steps] [--start-at "时间"|none] [--every 7|none] [--clock 8|none] [--earn 30000|none] [--count-step 1|none] [--link 7,13|none]
  python data_editor.py rm ID [ID ...]
  python data_editor.py move ID up|down
  python data_editor.py renumber [--start 1] 按当前顺序重排编号
  python data_editor.py version              查看版本名称与特殊任务的重置规则
  python data_editor.py version --name "异环 1.4 下半"
  python data_editor.py version --start "2026-10-05 05:00" --every 7   批量写入全部特殊任务
  python data_editor.py version --card-task 50   版本卡固定跟随 id 50（none 表示跟随最近的重置）
  python data_editor.py check                只校验，不写盘

分类 key：daily / weekly / special / monthly（也接受中文名）
特殊任务的重置时间不固定，存在每条任务的 startAt（开始时间）+ every（间隔天数）上，
重置时刻 = startAt + N × every 天，页面按当前时间往后取最近的一次。

任务机制（可选，留空即不启用，页面上不会出现对应区块）：
  --clock 8         勾选完成后 8 小时自动重置
  --earn 30000      用户在页面上填每小时收益，满一小时累加一次，达到 30000 就重置
  --count-step 1    每完成一次计数 +1，累计值显示在任务行和详情里
  --minor           标记为次要任务：排在已完成任务之后，不计入总次数（edit 时 --minor none 取消）
  --link 7,13       关联任务：本条为主任务，右边填从属任务编号（主任务完成 → 从属全部完成；
                    从属完成不影响主任务；主任务重置时从属一起重置，从属自己不得先重置）。
                    edit 时 --link none 取消关联
"""


def _flag_on(opt: dict, name: str):
    """读布尔开关：给了 --name 就是 True，--name none/off/false/0 是 False，没给返回 None"""
    if name not in opt:
        return None
    v = (opt.get(name) or [""])[0]
    if v is True:
        return True
    s = str(v).strip().lower()
    if s in ("none", "off", "false", "0", "no", "关", "清空", "-"):
        return False
    return True


def _parse_argv(argv):
    """拆成 (位置参数, 选项字典)，支持 --key value 与 --flag"""
    pos, opt = [], {}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a.startswith("--"):
            name = a[2:]
            if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
                opt.setdefault(name, []).append(argv[i + 1])
                i += 2
            else:
                opt.setdefault(name, []).append(True)
                i += 1
        else:
            pos.append(a)
            i += 1
    return pos, opt


def run_cli(argv) -> int:
    pos, opt = _parse_argv(argv)
    path = (opt.get("file") or [DEFAULT_DATA])[0]
    if pos:
        cmd = pos[0]
    elif opt.get("check"):
        cmd = "check"
    else:
        cmd = "list"

    if cmd in ("help", "-h", "?"):
        print(HELP)
        return 0

    try:
        df = DataFile(path)
    except Exception as e:
        print("打开失败：%s" % e)
        return 2

    def cat_key(value):
        if value in {c.get("key") for c in df.task_cats()}:
            return value
        return df.key_of_label(value)

    if cmd == "cat":
        for c in df.cats:
            note = "可放任务" if c.get("key") != "all" else "汇总用"
            extra = ""
            if c.get("reset") == "custom":
                extra = "　版本：%s" % (c.get("version") or "（未填写）")
            print(_pad(str(c.get("key")), 10) + _pad(str(c.get("label")), 8) + note + extra)
        for (start, every), tids in df.cycles():
            dt = _parse_iso(start)
            head = dt.strftime("%Y-%m-%d %H:%M") if dt else (start or "（未设开始）")
            print("  每 %s 天　起点 %s　编号 %s" % (
                every if every is not None else "?", head, "、".join(str(i) for i in tids)))
        return 0

    if cmd == "version":
        cat = df.special_cat()
        if cat is None:
            print("当前 data.js 里没有自定义重置的分类")
            return 2
        name = (opt.get("name") or [None])[0]
        start_raw = (opt.get("start") or [None])[0]
        every_raw = (opt.get("every") or [None])[0]
        card_raw = (opt.get("card-task") or [None])[0]
        if name is None and start_raw is None and every_raw is None and card_raw is None:
            print("版本名称：%s" % (cat.get("version") or "（未填写）"))
            cid = df.card_task()
            if cid is None:
                print("版本卡：跟随特殊任务里最近的一次重置")
            else:
                t = df.find(str(cid))
                print("版本卡：固定跟随 id %d%s" % (cid, "（%s）" % t.get("title") if t else "（任务不存在）"))
            rows = df.cycles()
            if not rows:
                print("重置规则：特殊任务都还没设置 startAt / every")
            for (start, every), tids in rows:
                dt = _parse_iso(start)
                head = dt.strftime("%Y-%m-%d %H:%M") if dt else (start or "（未设开始）")
                print("重置规则：起点 %s　每 %s 天　编号 %s" % (
                    head, every if every is not None else "?", "、".join(str(i) for i in tids)))
            return 0
        if name is not None:
            df.set_version(name)
        start = every = None
        if start_raw is not None:
            dt = _parse_iso(start_raw)
            if dt is None:
                print("--start 格式不对，示例：--start \"2026-10-05 05:00\"")
                return 2
            start = _fmt_iso(dt)
        if every_raw is not None:
            try:
                every = int(str(every_raw).strip())
            except ValueError:
                every = 0
            if every <= 0:
                print("--every 要是正整数天数，示例：--every 7")
                return 2
        changed = df.set_special_cycle(start=start, every=every) if (start or every) else 0
        card_note = ""
        if card_raw is not None:
            raw = str(card_raw).strip().lstrip("#")
            if raw.lower() in ("none", "清空", "-", "", "最近"):
                df.set_card_task(None)
                card_note = "版本卡改回跟随最近的重置"
            else:
                cid = _as_int(raw)
                if cid is None:
                    print("--card-task 要填任务编号，例如 --card-task 50（none 表示跟随最近的重置）")
                    return 2
                task = df.find(str(cid))
                if task is None:
                    print("没有 id=%d 的任务" % cid)
                    return 2
                if task not in df.special_tasks():
                    print("id=%d 不在特殊分类里，版本卡只能跟随特殊任务" % cid)
                    return 2
                df.set_card_task(cid)
                card_note = "版本卡固定跟随 id %d（%s）" % (cid, task.get("title"))
        saved = df.save()
        print("已更新版本：%s" % (cat.get("version") or "（未填写）"))
        if changed:
            bits = []
            if start is not None:
                bits.append("开始 %s" % _parse_iso(start).strftime("%Y-%m-%d %H:%M"))
            if every is not None:
                bits.append("每 %d 天重置" % every)
            print("已把 %d 条特殊任务设为 %s" % (changed, "，".join(bits)))
        if card_note:
            print(card_note)
        if saved:
            print("原文件已备份到 %s" % saved)
        return 0

    if cmd == "list":
        want = cat_key((opt.get("cat") or [""])[0]) if opt.get("cat") else ""
        grep = (opt.get("grep") or [""])[0]
        df.sort_tasks()
        shown = 0
        for t in df.tasks:
            if want and t.get("cat") != want:
                continue
            if grep and grep not in (t.get("title") or ""):
                continue
            shown += 1
            steps = t.get("steps") or []
            due = ""
            if t.get("startAt") or _as_int(t.get("every")) is not None:
                dt = _parse_iso(t.get("startAt"))
                every = _as_int(t.get("every"))
                bits = []
                if dt:
                    bits.append("起点 %s" % dt.strftime("%m-%d %H:%M"))
                if every:
                    bits.append("每 %d 天重置" % every)
                due = "　" + " · ".join(bits)
            mech = _mech_text(t)
            link = _link_text(t)
            notes = "　".join(x for x in (mech, link) if x)
            if notes:
                due += "　" + notes
            print("%3d  [%s]  %s  (%d 步)%s" % (t.get("id"), df.label_of(t.get("cat")), t.get("title"), len(steps), due))
            for s in steps:
                print("       · %s" % s)
        print("—— 共 %d / %d 条" % (shown, len(df.tasks)))
        return 0

    if cmd == "check":
        errors = df.validate()
        if errors:
            print("\n".join(errors))
            return 1
        from collections import Counter

        cnt = Counter(t.get("cat") for t in df.tasks)
        print("校验通过：%d 条任务" % len(df.tasks))
        for c in df.task_cats():
            print("  " + _pad(str(c.get("label")), 8) + "%d 条" % cnt.get(c.get("key"), 0))
        return 0

    if cmd == "add":
        if not opt.get("title"):
            print("缺少 --title")
            return 2
        cat = cat_key((opt.get("cat") or [df.task_cats()[0].get("key")])[0])
        if cat not in {c.get("key") for c in df.task_cats()}:
            print("分类不存在：%s" % cat)
            return 2
        task = df.add(cat, (opt["title"] or [""])[0], opt.get("step") or [])
        if opt.get("start-at"):
            raw = str((opt["start-at"] or [""])[0]).strip()
            if raw and raw.lower() not in ("none", "清空", "-"):
                dt = _parse_iso(raw)
                if dt is None:
                    print("--start-at 格式不对，示例：--start-at \"2026-10-05 05:00\"")
                    return 2
                task["startAt"] = _fmt_iso(dt)
        if opt.get("every"):
            every = _as_int(str((opt["every"] or [""])[0]).strip())
            if every is None:
                print("--every 要是正整数天数，示例：--every 7")
                return 2
            task["every"] = every
        for key, name in (("clock", "clock"), ("earn", "earn"), ("countStep", "count-step")):
            if opt.get(name):
                v = _as_num(str((opt[name] or [""])[0]).strip())
                if v is None:
                    print("--%s 要填正数（留空不写表示不启用）" % name)
                    return 2
                task[key] = int(v) if float(v).is_integer() else v
        if _flag_on(opt, "minor"):
            task["minor"] = True
        if opt.get("link"):
            ids, bad = _parse_link((opt["link"] or [""])[0])
            if bad:
                print("--link 要填任务编号，逗号分隔，例如 --link 7,13")
                return 2
            if ids:
                missing = [n for n in ids if df.find(str(n)) is None]
                if missing:
                    print("这些编号不存在：%s" % "、".join(str(n) for n in missing))
                    return 2
                task["link"] = ids
        saved = df.save()
        print("已新增 id=%d：%s（%s）" % (task["id"], task["title"], df.label_of(task["cat"])))
        if task.get("startAt") or _as_int(task.get("every")) is not None:
            print("重置规则：%s" % _cycle_text(task))
        if _mech_text(task):
            print("任务机制：%s" % _mech_text(task))
        if _link_text(task):
            print("关联任务：%s" % _link_text(task))
        if saved:
            print("原文件已备份到 %s" % saved)
        return 0

    if cmd == "edit":
        if len(pos) < 2:
            print("用法：edit ID [--title ...]")
            return 2
        task = df.find(pos[1])
        if task is None:
            print("没有 id=%s 的任务" % pos[1])
            return 2
        if opt.get("title"):
            task["title"] = (opt["title"] or [""])[0]
        if opt.get("cat"):
            df.set_cat(task, cat_key((opt["cat"] or [""])[0]))
        if opt.get("clear-steps"):
            task["steps"] = []
        elif opt.get("step"):
            task["steps"] = list(opt["step"])
        if opt.get("start-at"):
            raw = str((opt["start-at"] or [""])[0]).strip()
            if raw.lower() in ("none", "清空", "-", ""):
                task.pop("startAt", None)
            else:
                dt = _parse_iso(raw)
                if dt is None:
                    print("--start-at 格式不对，示例：--start-at \"2026-10-05 05:00\"")
                    return 2
                task["startAt"] = _fmt_iso(dt)
        if opt.get("every"):
            raw = str((opt["every"] or [""])[0]).strip()
            if raw.lower() in ("none", "清空", "-", ""):
                task.pop("every", None)
            else:
                every = _as_int(raw)
                if every is None:
                    print("--every 要是正整数天数，示例：--every 7")
                    return 2
                task["every"] = every
        for key, name in (("clock", "clock"), ("earn", "earn"), ("countStep", "count-step")):
            if opt.get(name):
                raw = str((opt[name] or [""])[0]).strip()
                if raw.lower() in ("none", "清空", "-", ""):
                    task.pop(key, None)
                else:
                    v = _as_num(raw)
                    if v is None:
                        print("--%s 要填正数，none 表示关闭这项机制" % name)
                        return 2
                    task[key] = int(v) if float(v).is_integer() else v
        minor = _flag_on(opt, "minor")
        if minor is True:
            task["minor"] = True
        elif minor is False:
            task.pop("minor", None)
        if opt.get("link"):
            ids, bad = _parse_link((opt["link"] or [""])[0])
            if bad:
                print("--link 要填任务编号，逗号分隔，例如 --link 7,13；none 表示取消关联")
                return 2
            if ids:
                if task["id"] in ids:
                    print("--link 不能包含自己")
                    return 2
                missing = [n for n in ids if df.find(str(n)) is None]
                if missing:
                    print("这些编号不存在：%s" % "、".join(str(n) for n in missing))
                    return 2
                task["link"] = ids
            else:
                task.pop("link", None)
        saved = df.save()
        print("已更新 id=%s：%s" % (task["id"], task["title"]))
        if task.get("startAt") or _as_int(task.get("every")) is not None:
            print("重置规则：%s" % _cycle_text(task))
        if _mech_text(task):
            print("任务机制：%s" % _mech_text(task))
        if _link_text(task):
            print("关联任务：%s" % _link_text(task))
        if saved:
            print("原文件已备份到 %s" % saved)
        return 0

    if cmd == "rm":
        if len(pos) < 2:
            print("用法：rm ID [ID ...]")
            return 2
        gone = []
        for raw in pos[1:]:
            t = df.find(raw)
            if t and df.remove(t["id"]):
                gone.append("%s(%s)" % (t["id"], t["title"]))
        if not gone:
            print("没有匹配的任务")
            return 2
        saved = df.save()
        print("已删除：%s" % "、".join(gone))
        if saved:
            print("原文件已备份到 %s" % saved)
        return 0

    if cmd == "move":
        if len(pos) < 3 or pos[2] not in ("up", "down", "上", "下", "上移", "下移"):
            print("用法：move ID up|down")
            return 2
        delta = 1 if pos[2] in ("down", "下", "下移") else -1
        if not df.move(pos[1], delta):
            task = df.find(pos[1])
            if task is None:
                print("没有 id=%s 的任务" % pos[1])
            else:
                print("「%s」已经在%s了" % (task.get("title"), "最前面" if delta < 0 else "最后面"))
            return 2
        saved = df.save()
        task = df.find(pos[1])
        print("已%s：%s" % ("上移" if delta < 0 else "下移", task.get("title")))
        if saved:
            print("原文件已备份到 %s" % saved)
        return 0

    if cmd in ("renumber", "renum", "number"):
        start = 1
        if opt.get("start"):
            try:
                start = int((opt["start"] or ["1"])[0])
            except ValueError:
                print("--start 需要整数")
                return 2
        if start < 1:
            print("--start 至少为 1")
            return 2
        total = len(df.tasks)
        if not total:
            print("没有任务可编号")
            return 2
        changed = df.renumber(start)
        saved = df.save()
        print("已按当前顺序重新编号 %d ~ %d（共 %d 条，%d 条编号有变化）"
              % (start, start + total - 1, total, len(changed)))
        if changed:
            print("提示：网页里的勾选进度按编号记录，重排后原来的勾选会对应到别的任务。")
        if saved:
            print("原文件已备份到 %s" % saved)
        return 0

    print(HELP)
    return 2


# --------------------------------------------------------------------------
# 五、图形界面
# --------------------------------------------------------------------------
if HAS_TK:

    def _enable_hidpi():
        if sys.platform != "win32":
            return 1.0
        try:
            import ctypes

            ctypes.windll.shcore.SetProcessDpiAwareness(1)
            dc = ctypes.windll.user32.GetDC(0)
            dpi = ctypes.windll.gdi32.GetDeviceCaps(dc, 88)  # LOGPIXELSX
            ctypes.windll.user32.ReleaseDC(0, dc)
            return dpi / 96.0
        except Exception:
            return 1.0

    class App(tk.Tk):
        BG = "#14181c"
        CARD = "#1b2027"
        LINE = "#2a323b"
        TEXT = "#e6eae8"
        MUTED = "#8b9791"
        ACCENT = "#d2ff38"
        ACCENT_INK = "#0b1004"
        SEARCH_HINT = "搜索标题或编号"

        def __init__(self, path: str):
            super().__init__()
            self.scale = _enable_hidpi()
            if self.scale != 1.0:
                self.tk.call("tk", "scaling", 96 / 72.0 * self.scale)

            self.df = DataFile(path)
            self.current_id = None
            self.dirty = False
            self.view = []

            self._font = ("Microsoft YaHei UI", 10)
            self._font_b = ("Microsoft YaHei UI", 10, "bold")
            self._mono = ("Consolas", 10)

            self.title(APP_TITLE)
            self.geometry("1180x760")
            self.minsize(940, 600)
            self.configure(bg=self.BG)
            self._build()
            self._refresh_all()
            self.protocol("WM_DELETE_WINDOW", self.on_close)
            self.bind_all("<Control-s>", lambda e: self.save_file())
            self.bind_all("<Control-S>", lambda e: self.save_file())

        # ---------------- 界面骨架 ----------------
        def _build(self):
            style = ttk.Style(self)
            try:
                style.theme_use("clam")
            except Exception:
                pass
            style.configure("TButton", font=self._font, padding=(12, 6))
            style.configure("TCombobox", font=self._font)
            self.option_add("*TCombobox*Listbox.font", self._font)

            top = tk.Frame(self, bg=self.BG)
            top.pack(fill="x", padx=16, pady=(14, 8))

            tk.Label(top, text="data.js 编辑器", font=("Microsoft YaHei UI", 13, "bold"),
                     bg=self.BG, fg=self.TEXT).pack(side="left")
            self.path_lbl = tk.Label(top, text="", font=self._font, bg=self.BG, fg=self.MUTED)
            self.path_lbl.pack(side="left", padx=(14, 0))

            tk.Button(top, text="保存到文件", command=self.save_file, font=self._font_b,
                      bg=self.ACCENT, fg=self.ACCENT_INK, activebackground=self.ACCENT,
                      activeforeground=self.ACCENT_INK, relief="flat", bd=0,
                      padx=16, pady=6, cursor="hand2").pack(side="right")
            tk.Button(top, text="重新加载", command=self.reload_file, font=self._font,
                      bg=self.CARD, fg=self.TEXT, activebackground=self.LINE, activeforeground=self.TEXT,
                      relief="flat", bd=0, padx=12, pady=6, cursor="hand2").pack(side="right", padx=8)
            tk.Button(top, text="版本信息", command=self.version_dialog, font=self._font,
                      bg=self.CARD, fg=self.TEXT, activebackground=self.LINE, activeforeground=self.TEXT,
                      relief="flat", bd=0, padx=12, pady=6, cursor="hand2").pack(side="right", padx=8)
            tk.Button(top, text="打开…", command=self.open_file, font=self._font,
                      bg=self.CARD, fg=self.TEXT, activebackground=self.LINE, activeforeground=self.TEXT,
                      relief="flat", bd=0, padx=12, pady=6, cursor="hand2").pack(side="right")

            body = tk.Frame(self, bg=self.BG)
            body.pack(fill="both", expand=True, padx=16, pady=(0, 8))

            # -- 左侧列表 --
            left = tk.Frame(body, bg=self.CARD, highlightbackground=self.LINE, highlightthickness=1)
            left.pack(side="left", fill="y")
            left.configure(width=380)
            left.pack_propagate(False)

            bar = tk.Frame(left, bg=self.CARD)
            bar.pack(fill="x", padx=12, pady=(12, 8))
            self.cat_box = ttk.Combobox(bar, state="readonly", width=8, font=self._font)
            self.cat_box.pack(side="left")
            self.cat_box.bind("<<ComboboxSelected>>", lambda e: self.refresh_list())
            self.search = tk.Entry(bar, font=self._font, bg="#0f1317", fg=self.MUTED,
                                   insertbackground=self.TEXT, relief="flat", bd=0,
                                   highlightthickness=1, highlightbackground=self.LINE,
                                   highlightcolor=self.ACCENT)
            self.search.pack(side="left", fill="x", expand=True, padx=(8, 0), ipady=4)
            self.search.insert(0, self.SEARCH_HINT)
            self.search.bind("<FocusIn>", self._search_in)
            self.search.bind("<FocusOut>", self._search_out)
            self.search.bind("<KeyRelease>", lambda e: self.refresh_list())
            self.search.bind("<Return>", lambda e: self.refresh_list())

            wrap = tk.Frame(left, bg=self.CARD)
            wrap.pack(fill="both", expand=True, padx=12, pady=(0, 12))
            sb = tk.Scrollbar(wrap, orient="vertical", width=10)
            sb.pack(side="right", fill="y")
            self.listbox = tk.Listbox(wrap, font=self._font, bg="#0f1317", fg=self.TEXT,
                                      selectbackground=self.ACCENT, selectforeground=self.ACCENT_INK,
                                      relief="flat", bd=0, highlightthickness=0,
                                      activestyle="none", yscrollcommand=sb.set, exportselection=False)
            self.listbox.pack(side="left", fill="both", expand=True)
            sb.configure(command=self.listbox.yview)
            self.listbox.bind("<<ListboxSelect>>", self.on_select)
            self.listbox.bind("<Alt-Up>", lambda e: (self.move_task(-1), "break")[1])
            self.listbox.bind("<Alt-Down>", lambda e: (self.move_task(1), "break")[1])
            self.bind_all("<Alt-Up>", lambda e: self._hotkey_move(-1))
            self.bind_all("<Alt-Down>", lambda e: self._hotkey_move(1))

            foot = tk.Frame(left, bg=self.CARD)
            foot.pack(fill="x", padx=12, pady=(0, 12))
            self._btn(foot, "↑ 上移", lambda: self.move_task(-1)).pack(side="left")
            self._btn(foot, "↓ 下移", lambda: self.move_task(1)).pack(side="left", padx=6)
            self.btn_num = self._btn(foot, "一键编号", self.renumber_all)
            self.btn_num.pack(side="right")

            # -- 右侧表单 --
            right = tk.Frame(body, bg=self.BG)
            right.pack(side="left", fill="both", expand=True, padx=(16, 0))

            card = tk.Frame(right, bg=self.CARD, highlightbackground=self.LINE, highlightthickness=1)
            card.pack(fill="both", expand=True)

            inner = tk.Frame(card, bg=self.CARD)
            inner.pack(fill="both", expand=True, padx=18, pady=16)

            row = tk.Frame(inner, bg=self.CARD)
            row.pack(fill="x")
            self._label(row, "编号").pack(side="left")
            self.id_var = tk.StringVar()
            self.id_entry = tk.Entry(row, textvariable=self.id_var, font=self._mono, width=8,
                                     state="readonly", readonlybackground="#0f1317", fg=self.ACCENT,
                                     relief="flat", bd=0, justify="center",
                                     highlightthickness=1, highlightbackground=self.LINE)
            self.id_entry.pack(side="left", ipady=5)
            self._label(row, "分类").pack(side="left", padx=(24, 8))
            self.f_cat = ttk.Combobox(row, state="readonly", width=10, font=self._font)
            self.f_cat.pack(side="left")
            self.f_cat.bind("<<ComboboxSelected>>", lambda e: self._sync_cycle_state())

            self._label(inner, "任务名称").pack(anchor="w", pady=(16, 6))
            self.f_title = tk.Entry(inner, font=("Microsoft YaHei UI", 11), bg="#0f1317", fg=self.TEXT,
                                    insertbackground=self.TEXT, relief="flat", bd=0,
                                    highlightthickness=1, highlightbackground=self.LINE,
                                    highlightcolor=self.ACCENT)
            self.f_title.pack(fill="x", ipady=8)

            # 重置规则只对「特殊」分类有意义：开始时间 + 每隔多少天重置，每条任务各自一份
            start_row = tk.Frame(inner, bg=self.CARD)
            start_row.pack(fill="x", pady=(14, 0))
            self._label(start_row, "开始时间").pack(side="left")
            self.f_start = tk.Entry(start_row, font=self._font, bg="#0f1317", fg=self.TEXT,
                                    insertbackground=self.TEXT, relief="flat", bd=0,
                                    highlightthickness=1, highlightbackground=self.LINE,
                                    highlightcolor=self.ACCENT)
            self.f_start.pack(side="left", fill="x", expand=True, padx=(12, 10), ipady=6)
            tk.Label(start_row, text="例 2026-10-05 05:00 · 仅特殊任务", font=("Microsoft YaHei UI", 9),
                     bg=self.CARD, fg=self.MUTED).pack(side="left")

            every_row = tk.Frame(inner, bg=self.CARD)
            every_row.pack(fill="x", pady=(8, 0))
            self._label(every_row, "重置间隔").pack(side="left")
            self.f_every = tk.Entry(every_row, font=self._font, bg="#0f1317", fg=self.TEXT, width=6,
                                    insertbackground=self.TEXT, relief="flat", bd=0,
                                    highlightthickness=1, highlightbackground=self.LINE,
                                    highlightcolor=self.ACCENT)
            self.f_every.pack(side="left", padx=(12, 8), ipady=6)
            tk.Label(every_row, text="天 · 从开始时间起每 N 天重置一次", font=("Microsoft YaHei UI", 9),
                     bg=self.CARD, fg=self.MUTED).pack(side="left")

            # 可选机制：留空即不启用，页面上不会出现对应区块
            mech_row = tk.Frame(inner, bg=self.CARD)
            mech_row.pack(fill="x", pady=(8, 0))
            self._label(mech_row, "任务机制").pack(side="left")
            self.f_clock = self._mini(mech_row, 5)
            self.f_clock.pack(side="left", padx=(12, 5))
            tk.Label(mech_row, text="小时重置", font=("Microsoft YaHei UI", 9),
                     bg=self.CARD, fg=self.MUTED).pack(side="left")
            self.f_earn = self._mini(mech_row, 7)
            self.f_earn.pack(side="left", padx=(12, 5))
            tk.Label(mech_row, text="收益目标", font=("Microsoft YaHei UI", 9),
                     bg=self.CARD, fg=self.MUTED).pack(side="left")
            self.f_count = self._mini(mech_row, 5)
            self.f_count.pack(side="left", padx=(12, 5))
            tk.Label(mech_row, text="每次计数", font=("Microsoft YaHei UI", 9),
                     bg=self.CARD, fg=self.MUTED).pack(side="left")
            tk.Label(inner, text="三项都留空 = 普通任务；填了才在页面上生效（计时从勾选完成时开始）",
                     font=("Microsoft YaHei UI", 9), bg=self.CARD, fg=self.MUTED,
                     anchor="w").pack(fill="x", pady=(4, 0))

            # 任务类型：次要任务排在已完成之后、不计入总次数
            minor_row = tk.Frame(inner, bg=self.CARD)
            minor_row.pack(fill="x", pady=(8, 0))
            self._label(minor_row, "任务类型").pack(side="left")
            self.f_minor = tk.BooleanVar(master=self, value=False)
            tk.Checkbutton(minor_row, text="次要任务 · 排在已完成之后，不计入总次数",
                           variable=self.f_minor, font=("Microsoft YaHei UI", 9),
                           bg=self.CARD, fg=self.TEXT, activebackground=self.CARD,
                           activeforeground=self.TEXT, selectcolor="#0f1317",
                           relief="flat", bd=0, highlightthickness=0, cursor="hand2").pack(side="left", padx=(12, 0))

            # 关联任务：本条为主任务，右边填从属任务的编号
            link_row = tk.Frame(inner, bg=self.CARD)
            link_row.pack(fill="x", pady=(8, 0))
            self._label(link_row, "关联任务").pack(side="left")
            self.f_link = tk.Entry(link_row, font=("Microsoft YaHei UI", 10), bg="#0f1317", fg=self.TEXT,
                                   insertbackground=self.TEXT, relief="flat", bd=0,
                                   highlightthickness=1, highlightbackground=self.LINE,
                                   highlightcolor=self.ACCENT)
            self.f_link.pack(side="left", fill="x", expand=True, padx=(12, 0), ipady=3)
            tk.Label(inner, text="填任务编号，逗号分隔（如 7, 13）；主任务完成时从属一起完成，从属完成不影响主任务；主任务重置时一起重置，留空表示不关联",
                     font=("Microsoft YaHei UI", 9), bg=self.CARD, fg=self.MUTED,
                     anchor="w").pack(fill="x", pady=(3, 0))

            head = tk.Frame(inner, bg=self.CARD)
            head.pack(fill="x", pady=(14, 6))
            self._label(head, "攻略步骤").pack(side="left")
            tk.Label(head, text="一行一步，空行会被忽略", font=("Microsoft YaHei UI", 9),
                     bg=self.CARD, fg=self.MUTED).pack(side="left", padx=(10, 0))

            self.f_steps = tk.Text(inner, font=self._font, bg="#0f1317", fg=self.TEXT,
                                   insertbackground=self.TEXT, relief="flat", bd=0, wrap="word",
                                   undo=True, padx=10, pady=8, height=11,
                                   highlightthickness=1, highlightbackground=self.LINE,
                                   highlightcolor=self.ACCENT)
            self.f_steps.pack(fill="both", expand=True)

            btns = tk.Frame(inner, bg=self.CARD)
            btns.pack(fill="x", pady=(16, 0))
            self._btn(btns, "应用修改", self.apply_form, primary=True).pack(side="left")
            self._btn(btns, "新增任务", self.add_task).pack(side="left", padx=8)
            self._btn(btns, "删除", self.del_task, danger=True).pack(side="left")
            tk.Label(btns, text="Alt+↑ / Alt+↓ 可快速移动", font=("Microsoft YaHei UI", 9),
                     bg=self.CARD, fg=self.MUTED).pack(side="right")

            self.status = tk.Label(self, text="", font=self._font, bg=self.BG, fg=self.MUTED, anchor="w")
            self.status.pack(fill="x", padx=18, pady=(0, 10))

        def _label(self, parent, text):
            return tk.Label(parent, text=text, font=self._font_b, bg=self.CARD, fg=self.MUTED)

        def _mini(self, parent, width):
            """表单里的小号数字输入框（计时 / 收益 / 计数）"""
            return tk.Entry(parent, font=("Microsoft YaHei UI", 10), bg="#0f1317", fg=self.TEXT,
                            width=width, insertbackground=self.TEXT, relief="flat", bd=0,
                            highlightthickness=1, highlightbackground=self.LINE,
                            highlightcolor=self.ACCENT)

        def _btn(self, parent, text, cmd, primary=False, danger=False):
            if primary:
                bg, fg = self.ACCENT, self.ACCENT_INK
            elif danger:
                bg, fg = self.CARD, "#ff8a8a"
            else:
                bg, fg = self.LINE, self.TEXT
            return tk.Button(parent, text=text, command=cmd, font=self._font_b, bg=bg, fg=fg,
                             activebackground=bg, activeforeground=fg, relief="flat", bd=0,
                             padx=14, pady=7, cursor="hand2")

        # ---------------- 数据 -> 界面 ----------------
        def _refresh_all(self):
            self.df.sort_tasks()
            self.cat_box["values"] = ["全部"] + [c.get("label") for c in self.df.task_cats()]
            if not self.cat_box.get():
                self.cat_box.set("全部")
            self.f_cat["values"] = [c.get("label") for c in self.df.task_cats()]
            self.path_lbl.configure(text=self.df.path)
            self.refresh_list()
            self._update_title()

        def refresh_list(self):
            self.listbox.delete(0, "end")
            want = self.cat_box.get()
            key = "" if want in ("", "全部") else self.df.key_of_label(want)
            raw = self.search.get().strip()
            q = "" if raw == self.SEARCH_HINT else raw.lower()
            self.view = [
                t for t in self.df.tasks
                if (not key or t.get("cat") == key)
                and (not q or q in str(t.get("title", "")).lower() or q in str(t.get("id")))
            ]
            for t in self.view:
                due = ""
                if t.get("startAt") or _as_int(t.get("every")) is not None:
                    dt = _parse_iso(t.get("startAt"))
                    every = _as_int(t.get("every"))
                    bits = []
                    if dt:
                        bits.append("起点 %s" % dt.strftime("%m-%d %H:%M"))
                    if every:
                        bits.append("每 %d 天" % every)
                    due = "　" + " · ".join(bits)
                if _mech_text(t):
                    due += "　· 有机制"
                kids = _link_ids(t)
                if kids:
                    due += "　· 关联 %d 条" % len(kids)
                self.listbox.insert("end", "#%-3s %s · %s%s" % (
                    t.get("id"), self.df.label_of(t.get("cat")), t.get("title"), due))
            if self.current_id is not None:
                for i, t in enumerate(self.view):
                    if int(t.get("id", -1)) == int(self.current_id):
                        self.listbox.selection_set(i)
                        self.listbox.see(i)
                        break
            self._update_status()

        def _update_title(self):
            self.title(APP_TITLE + ("  *" if self.dirty else ""))

        def _update_status(self):
            total = len(self.df.tasks)
            done = sum(1 for t in self.df.tasks if t.get("steps"))
            self.status.configure(
                text="共 %d 条任务（%d 条有攻略步骤）　当前显示 %d 条　%s"
                % (total, done, len(self.view), "有未保存的修改" if self.dirty else "已保存")
            )
            self._update_title()

        # ---------------- 界面 -> 表单 ----------------
        def _search_in(self, _evt=None):
            if self.search.get() == self.SEARCH_HINT:
                self.search.delete(0, "end")
                self.search.configure(fg=self.TEXT)

        def _search_out(self, _evt=None):
            if not self.search.get().strip():
                self.search.delete(0, "end")
                self.search.insert(0, self.SEARCH_HINT)
                self.search.configure(fg=self.MUTED)
                self.refresh_list()

        def on_select(self, _evt=None):
            sel = self.listbox.curselection()
            if not sel:
                return
            task = self.view[sel[0]]
            self.load_task(task)

        def load_task(self, task):
            self.current_id = int(task.get("id", 0))
            self.id_var.set(str(task.get("id")))
            self.f_cat.set(self.df.label_of(task.get("cat")))
            self.f_title.delete(0, "end")
            self.f_title.insert(0, task.get("title") or "")
            self.f_start.delete(0, "end")
            raw_start = task.get("startAt") or ""
            dt = _parse_iso(raw_start)
            self.f_start.insert(0, dt.strftime("%Y-%m-%d %H:%M") if dt else raw_start)
            self.f_every.delete(0, "end")
            every = _as_int(task.get("every"))
            if every:
                self.f_every.insert(0, str(every))
            self._sync_cycle_state()
            self.f_minor.set(bool(task.get("minor")))
            self.f_link.delete(0, "end")
            kids = _link_ids(task)
            if kids:
                self.f_link.insert(0, ", ".join(str(n) for n in kids))
            for box, key in ((self.f_clock, "clock"), (self.f_earn, "earn"), (self.f_count, "countStep")):
                box.delete(0, "end")
                v = _as_num(task.get(key))
                if v is not None:
                    box.insert(0, _num_text(v))
            self.f_steps.delete("1.0", "end")
            self.f_steps.insert("1.0", "\n".join(task.get("steps") or []))
            # 让列表同步高亮（被搜索过滤掉时找不到就跳过）
            for i, t in enumerate(self.view):
                if t is task:
                    self.listbox.selection_clear(0, "end")
                    self.listbox.selection_set(i)
                    self.listbox.see(i)
                    break

        def _cat_of_form(self):
            key = self.df.key_of_label(self.f_cat.get())
            return next((c for c in self.df.task_cats() if c.get("key") == key), None)

        def _sync_cycle_state(self):
            """只有特殊任务能填重置规则，其它分类直接禁用以防误填"""
            cat = self._cat_of_form()
            special = bool(cat and cat.get("reset") == "custom")
            for box in (self.f_start, self.f_every):
                if special:
                    box.configure(state="normal")
                else:
                    box.delete(0, "end")
                    box.configure(state="disabled", disabledbackground=self.LINE,
                                  disabledforeground=self.MUTED)

        def _form_steps(self):
            raw = self.f_steps.get("1.0", "end")
            return [ln.strip() for ln in raw.splitlines() if ln.strip()]

        def apply_form(self, silent=False):
            if self.current_id is None:
                if not silent:
                    messagebox.showinfo("提示", "先在左边选中一个任务，或者点「新增任务」。")
                return False
            task = self.df.find(self.current_id)
            if task is None:
                return False
            title = self.f_title.get().strip()
            if not title:
                if not silent:
                    messagebox.showwarning("标题为空", "任务名称不能为空。")
                return False
            task["title"] = title
            task["steps"] = self._form_steps()
            self.df.set_cat(task, self.df.key_of_label(self.f_cat.get()))
            cat = self._cat_of_form()
            if cat and cat.get("reset") == "custom":
                start = self.f_start.get().strip()
                every = self.f_every.get().strip()
                if start:
                    dt = _parse_iso(start)
                    if dt is None:
                        if not silent:
                            messagebox.showwarning("开始时间格式不对",
                                                   "示例：2026-10-05 05:00\n留空表示这条特殊任务暂不设开始时间。")
                        return False
                    task["startAt"] = _fmt_iso(dt)
                else:
                    task.pop("startAt", None)
                if every:
                    n = _as_int(every)
                    if n is None:
                        if not silent:
                            messagebox.showwarning("重置间隔不对", "填正整数天数，例如 7。")
                        return False
                    task["every"] = n
                else:
                    task.pop("every", None)
            else:
                task.pop("startAt", None)
                task.pop("every", None)
            # 可选机制：留空即移除字段，页面上对应区块随之消失
            for key, box, label in (("clock", self.f_clock, "计时小时数"),
                                    ("earn", self.f_earn, "收益目标"),
                                    ("countStep", self.f_count, "每次计数")):
                raw = box.get().strip()
                if not raw:
                    task.pop(key, None)
                    continue
                v = _as_num(raw)
                if v is None:
                    if not silent:
                        messagebox.showwarning("%s 不对" % label, "填正数，留空表示不启用这项机制。")
                    return False
                task[key] = int(v) if float(v).is_integer() else v
            if self.f_minor.get():
                task["minor"] = True
            else:
                task.pop("minor", None)
            # 关联任务：留空即取消关联；填的编号必须在同一份数据里存在
            raw_link = self.f_link.get().strip()
            if not raw_link:
                task.pop("link", None)
            else:
                ids, bad = _parse_link(raw_link)
                if bad:
                    if not silent:
                        messagebox.showwarning("关联任务编号不对", "填任务编号，逗号分隔，例如 7, 13。")
                    return False
                if task.get("id") in ids:
                    if not silent:
                        messagebox.showwarning("不能关联自己", "关联任务里不要写本条任务自己的编号。")
                    return False
                missing = [n for n in ids if self.df.find(str(n)) is None]
                if missing:
                    if not silent:
                        messagebox.showwarning("编号不存在", "这些编号没有对应任务：%s"
                                               % "、".join(str(n) for n in missing))
                    return False
                if ids:
                    task["link"] = ids
                else:
                    task.pop("link", None)
            self.dirty = True
            self.df.sort_tasks()
            self.refresh_list()
            self._update_status()
            return True

        # ---------------- 按钮动作 ----------------
        def add_task(self):
            if self.current_id is not None:
                self.apply_form(silent=True)
            want = self.cat_box.get()
            cat = "daily" if want in ("", "全部") else self.df.key_of_label(want)
            task = self.df.add(cat, "新任务", [])
            self.current_id = int(task["id"])
            self.dirty = True
            self.df.sort_tasks()
            self.refresh_list()
            self.load_task(task)
            self.f_title.focus_set()
            self.f_title.selection_range(0, "end")

        def del_task(self):
            if self.current_id is None:
                messagebox.showinfo("提示", "先选中要删除的任务。")
                return
            task = self.df.find(self.current_id)
            if task is None:
                return
            if not messagebox.askyesno("删除任务", "确定删除「%s」吗？\n编号 %s 不会回收，已勾选的进度会失去对应。" % (task.get("title"), task.get("id"))):
                return
            self.df.remove(task["id"])
            self.current_id = None
            self.dirty = True
            self.id_var.set("")
            self.f_title.delete(0, "end")
            self.f_start.delete(0, "end")
            self.f_every.delete(0, "end")
            self.f_clock.delete(0, "end")
            self.f_earn.delete(0, "end")
            self.f_count.delete(0, "end")
            self.f_link.delete(0, "end")
            self.f_minor.set(False)
            self.f_steps.delete("1.0", "end")
            self.refresh_list()

        def _hotkey_move(self, delta):
            if self.current_id is not None and self.focus_get() is not self.listbox:
                self.move_task(delta)
            return "break"

        def move_task(self, delta):
            if self.current_id is None:
                self.status.configure(text="先在左边列表里选中一条任务，再上移 / 下移")
                return
            if not self.apply_form(silent=True):
                return
            task = self.df.find(self.current_id)
            if task is None:
                return
            if not self.df.can_move(self.current_id, delta):
                self.status.configure(
                    text="「%s」已经在%s条了" % (task.get("title"), "最前" if delta < 0 else "最后")
                )
                return
            self.df.move(self.current_id, delta)
            self.dirty = True
            self.refresh_list()
            self._update_status()
            self.status.configure(
                text="已%s：「%s」（还在 %s，尚未写盘）"
                % ("上移" if delta < 0 else "下移", task.get("title"), self.df.label_of(task.get("cat")))
            )

        def renumber_all(self):
            """按列表顺序把编号重排为 1..N"""
            if self.current_id is not None and not self.apply_form(silent=True):
                return
            total = len(self.df.tasks)
            if not total:
                return
            ok = messagebox.askyesno(
                "一键编号",
                "按当前顺序（每日 → 每周 → 特殊 → 每月，组内自上而下）"
                "把 %d 条任务的编号重排为 1 ~ %d。\n\n"
                "注意：网页里的勾选进度是按编号记录的，重排后原先的勾选会对应到别的任务。\n"
                "如果网页里已有进度，建议先清空再重排。\n\n继续吗？" % (total, total),
            )
            if not ok:
                return
            old_id = self.current_id
            changed = self.df.renumber(1)
            if old_id is not None:
                self.current_id = changed.get(old_id, old_id)
            self.dirty = True
            self.refresh_list()
            if self.current_id is not None:
                self.id_var.set(str(self.current_id))
            self._update_status()
            self.status.configure(
                text="已重新编号 1 ~ %d，其中 %d 条编号有变化（点「保存到文件」才会写盘）"
                % (total, len(changed))
            )

        def save_file(self):
            if self.current_id is not None:
                self.apply_form(silent=True)
            try:
                backup = self.df.save()
            except ValueError as e:
                messagebox.showerror("保存失败", str(e))
                return
            except Exception as e:
                messagebox.showerror("保存失败", "%s" % e)
                return
            self.dirty = False
            self._update_status()
            self.status.configure(text="已保存到 %s%s" % (self.df.path, ("　（原文件已备份到 %s）" % backup) if backup else ""))
            self._update_title()

        def version_dialog(self):
            """编辑版本名称与版本卡跟随的任务；各特殊任务的重置规则在任务表单里逐条设置"""
            cat = self.df.special_cat()
            if cat is None:
                messagebox.showinfo("版本信息", "当前 data.js 里没有「自定义重置」的分类。")
                return

            dlg = tk.Toplevel(self)
            dlg.title("版本信息")
            dlg.configure(bg=self.BG)
            dlg.transient(self)
            dlg.resizable(False, False)
            dlg.grab_set()

            box = tk.Frame(dlg, bg=self.CARD, highlightbackground=self.LINE, highlightthickness=1)
            box.pack(fill="both", expand=True, padx=14, pady=14)
            inner = tk.Frame(box, bg=self.CARD)
            inner.pack(fill="both", expand=True, padx=18, pady=16)

            def label(text):
                return tk.Label(inner, text=text, font=self._font_b, bg=self.CARD,
                                fg=self.MUTED, anchor="w")

            def entry(var):
                e = tk.Entry(inner, textvariable=var, font=("Microsoft YaHei UI", 11),
                             bg="#0f1317", fg=self.TEXT, insertbackground=self.TEXT, width=34,
                             relief="flat", bd=0, highlightthickness=1,
                             highlightbackground=self.LINE, highlightcolor=self.ACCENT)
                e.pack(fill="x", ipady=7, pady=(6, 14))
                return e

            label("版本名称").pack(fill="x")
            name_var = tk.StringVar(value=cat.get("version") or "")
            name_entry = entry(name_var)

            # 版本卡的倒计时可以固定跟随某条特殊任务，默认跟随最近的一次重置
            label("版本卡倒计时").pack(fill="x")
            tasks = self.df.special_tasks()
            card_choices = ["跟随最近的一次重置"] + [
                "#%s　%s" % (t.get("id"), t.get("title")) for t in tasks
            ]
            cur = self.df.card_task()
            cur_idx = 0
            for i, t in enumerate(tasks, 1):
                if cur is not None and _as_int(t.get("id")) == cur:
                    cur_idx = i
            card_var = tk.StringVar(value=card_choices[cur_idx])
            ttk.Combobox(inner, textvariable=card_var, values=card_choices, state="readonly",
                         font=("Microsoft YaHei UI", 10)).pack(fill="x", pady=(6, 14))

            rows = self.df.cycles()
            if rows:
                rule_text = "当前重置规则：\n" + "\n".join(
                    "· 起点 %s　每 %s 天　编号 %s" % (
                        (_parse_iso(start).strftime("%Y-%m-%d %H:%M") if _parse_iso(start) else (start or "（未设）")),
                        every if every is not None else "?", "、".join(str(i) for i in tids))
                    for (start, every), tids in rows
                )
            else:
                rule_text = "特殊任务还没设置重置规则。"
            tk.Label(inner, text="版本名称显示在首页的版本卡上；版本卡倒计时可固定跟随某条特殊任务。"
                                "各特殊任务的重置规则不固定，请在任务表单的「开始时间 / 重置间隔」里逐条填写。\n\n" + rule_text,
                     font=("Microsoft YaHei UI", 9), bg=self.CARD, fg=self.MUTED,
                     anchor="w", justify="left", wraplength=430).pack(fill="x", pady=(0, 14))

            btns = tk.Frame(inner, bg=self.CARD)
            btns.pack(fill="x")

            def commit():
                name = name_var.get().strip()
                pick = card_var.get()
                idx = card_choices.index(pick) if pick in card_choices else 0
                self.df.set_version(name)
                if idx > 0:
                    self.df.set_card_task(tasks[idx - 1].get("id"))
                else:
                    self.df.set_card_task(None)
                self.dirty = True
                self._update_status()
                self.status.configure(text="版本信息已更新：%s · %s（点「保存到文件」才会写盘）"
                                           % (name or "（未填写）",
                                              "固定跟随 " + pick if idx > 0 else "跟随最近的重置"))
                dlg.destroy()

            self._btn(btns, "保存", commit, primary=True).pack(side="right")
            self._btn(btns, "取消", dlg.destroy).pack(side="right", padx=8)

            dlg.update_idletasks()
            x = self.winfo_rootx() + (self.winfo_width() - dlg.winfo_width()) // 2
            y = self.winfo_rooty() + 110
            dlg.geometry("+%d+%d" % (max(0, x), max(0, y)))
            name_entry.focus_set()

        def reload_file(self):
            if self.dirty and not messagebox.askyesno("放弃修改", "有未保存的修改，确定重新加载吗？"):
                return
            try:
                self.df.reload()
            except Exception as e:
                messagebox.showerror("读取失败", "%s" % e)
                return
            self.current_id = None
            self.dirty = False
            self.id_var.set("")
            self.f_title.delete(0, "end")
            self.f_start.delete(0, "end")
            self.f_every.delete(0, "end")
            self.f_clock.delete(0, "end")
            self.f_earn.delete(0, "end")
            self.f_count.delete(0, "end")
            self.f_link.delete(0, "end")
            self.f_minor.set(False)
            self.f_steps.delete("1.0", "end")
            self._refresh_all()

        def open_file(self):
            if self.dirty and not messagebox.askyesno("放弃修改", "有未保存的修改，确定要打开别的文件吗？"):
                return
            path = filedialog.askopenfilename(
                title="选择 data.js", initialdir=os.path.dirname(self.df.path),
                filetypes=[("JavaScript", "*.js"), ("所有文件", "*.*")],
            )
            if not path:
                return
            try:
                self.df = DataFile(path)
            except Exception as e:
                messagebox.showerror("读取失败", "%s" % e)
                return
            self.current_id = None
            self.dirty = False
            self.id_var.set("")
            self.f_title.delete(0, "end")
            self.f_start.delete(0, "end")
            self.f_every.delete(0, "end")
            self.f_clock.delete(0, "end")
            self.f_earn.delete(0, "end")
            self.f_count.delete(0, "end")
            self.f_link.delete(0, "end")
            self.f_minor.set(False)
            self.f_steps.delete("1.0", "end")
            self._refresh_all()

        def on_close(self):
            if self.dirty and not messagebox.askyesno("退出", "有未保存的修改，仍要退出吗？"):
                return
            self.destroy()


# --------------------------------------------------------------------------
# 入口
# --------------------------------------------------------------------------
def find_tk_python():
    """当前解释器没有 tkinter 时，在本机找一台带 tkinter 的 Python。
    只用于图形界面；命令行功能任何 Python 都能用。"""
    if sys.platform != "win32":
        return None
    import glob
    import subprocess

    me = os.path.abspath(sys.executable)
    patterns = [
        r"D:\Python*\python.exe",
        r"C:\Python*\python.exe",
        r"%LocalAppData%\Programs\Python\Python*\python.exe",
        r"%ProgramFiles%\Python*\python.exe",
    ]
    seen = set()
    for pat in patterns:
        for cand in sorted(glob.glob(os.path.expandvars(pat))):
            path = os.path.abspath(cand)
            if path in seen or path.lower() == me.lower():
                continue
            seen.add(path)
            try:
                r = subprocess.run([path, "-c", "import tkinter"], capture_output=True, timeout=10)
            except Exception:
                continue
            if r.returncode == 0:
                return path
    return None


CLI_COMMANDS = {"list", "cat", "add", "edit", "rm", "move", "renumber", "renum", "number", "version", "check"}


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] in ("-h", "--help", "help"):
        print(HELP)
        return 0
    if argv and (argv[0].startswith("-") or argv[0] in CLI_COMMANDS):
        try:
            return run_cli(argv)
        except ValueError as e:  # 数据校验没通过：把原因说清楚，别抛一堆栈
            print(str(e))
            return 1

    path = argv[0] if argv else DEFAULT_DATA
    if not HAS_TK:
        alt = find_tk_python()
        if alt:
            print("当前 Python 没有 tkinter，改用 %s 启动界面…" % alt)
            import subprocess

            return subprocess.call([alt, os.path.abspath(__file__)] + list(sys.argv[1:]))
        print("没有找到带 tkinter 的 Python，无法打开图形界面。")
        print(HELP)
        return 1

    app = App(path)
    app.mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
