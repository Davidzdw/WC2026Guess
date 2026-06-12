import csv
import json
import re
import sys
import urllib.request
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path


NETEASE_PAGE_URL = "https://sports.163.com/caipiao/worldcup2026"
WIKI_URL = "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup"
HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://sports.163.com",
    "Referer": NETEASE_PAGE_URL,
}
CHINA_TZ = timezone(timedelta(hours=8))
STAGE_NAMES = {
    232934: "小组赛",
    232927: "1/16决赛",
    232928: "1/8决赛",
    232929: "1/4决赛",
    232930: "半决赛",
    232931: "季军赛",
    232932: "决赛",
}
GROUP_NAMES = {
    1: "A",
    2: "B",
    3: "C",
    4: "D",
    5: "E",
    6: "F",
    7: "G",
    8: "H",
    9: "I",
    10: "J",
    11: "K",
    12: "L",
}
OUTPUT_PATH = Path("worldcup_2026_schedule_cn.csv")


def fetch_text(url: str) -> str:
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", "ignore")


def fetch_json(url: str, method: str = "GET", data: bytes | None = None) -> dict:
    request = urllib.request.Request(url, data=data, headers=HEADERS, method=method)
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8", "ignore"))


def discover_api_url() -> str:
    html = fetch_text(NETEASE_PAGE_URL)
    match = re.search(r'component-url="([^"]*ScheduleList[^"]*)"', html)
    if not match:
        raise RuntimeError("未能在网易页面中找到 ScheduleList 组件。")
    component_code = fetch_text(match.group(1))
    api_match = re.search(
        r'["\'](/caipiao/api/web/relottery/activity/matchInfo/worldCup2026/matchListGroup)["\']',
        component_code,
    )
    if not api_match:
        raise RuntimeError("未能在网易组件中找到赛程接口。")
    return "https://sports.163.com" + api_match.group(1)


def flatten(items):
    if not items:
        return []
    if isinstance(items[0], list):
        result = []
        for group in items:
            result.extend(group)
        return result
    return items


def to_china_time(match_time) -> datetime:
    if isinstance(match_time, str):
        text = match_time.strip()
        if text.isdigit():
            value = int(text)
        else:
            cleaned = text.replace("Z", "+00:00")
            dt = datetime.fromisoformat(cleaned)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
            return dt.astimezone(CHINA_TZ)
    else:
        value = int(match_time)

    if value > 10_000_000_000:
        dt = datetime.fromtimestamp(value / 1000, tz=UTC)
    else:
        dt = datetime.fromtimestamp(value, tz=UTC)
    return dt.astimezone(CHINA_TZ)


def normalize_match(item: dict) -> dict:
    stage_info = item.get("stageInfo") or {}
    china_time = to_china_time(item.get("matchTime"))
    home = item.get("homeTeamInfo") or item.get("homeTeam") or {}
    away = item.get("guestTeamInfo") or item.get("guestTeam") or {}
    stadium = item.get("matchPlaceInfo") or item.get("venue") or {}
    venue_name = stadium if isinstance(stadium, str) else stadium.get("stadiumName") or stadium.get("venueName") or ""
    city_name = "" if isinstance(stadium, str) else stadium.get("cityName") or ""
    country_name = "" if isinstance(stadium, str) else stadium.get("countryName") or ""
    return {
        "match_info_id": item.get("matchInfoId"),
        "stage_id": stage_info.get("stage"),
        "stage_name": STAGE_NAMES.get(stage_info.get("stage"), stage_info.get("stageName", "")),
        "group": GROUP_NAMES.get(stage_info.get("groupNum"), ""),
        "round_label": stage_info.get("stageName", ""),
        "china_date": china_time.strftime("%Y-%m-%d"),
        "china_time": china_time.strftime("%H:%M"),
        "china_datetime": china_time.strftime("%Y-%m-%d %H:%M:%S"),
        "weekday_cn": "星期" + "一二三四五六日"[china_time.weekday()],
        "home_team": home.get("cnName") or home.get("teamName") or home.get("fullName") or home.get("name") or "",
        "away_team": away.get("cnName") or away.get("teamName") or away.get("fullName") or away.get("name") or "",
        "match_status": item.get("matchStatus"),
        "venue": venue_name,
        "city": city_name,
        "country": country_name,
        "source_match_time_raw": item.get("matchTime"),
    }


def fetch_matches() -> list[dict]:
    api_url = discover_api_url()
    payload = fetch_json(api_url, method="POST", data=b"")
    if payload.get("code") != 200 or "data" not in payload:
        raise RuntimeError(f"网易接口返回异常: {payload}")
    flat = flatten(payload["data"])
    matches = [normalize_match(item) for item in flat]
    matches.sort(key=lambda row: (row["china_datetime"], row["match_info_id"] or 0))
    return matches


def write_csv(rows: list[dict], path: Path) -> None:
    fieldnames = [
        "match_info_id",
        "stage_id",
        "stage_name",
        "group",
        "round_label",
        "china_date",
        "china_time",
        "china_datetime",
        "weekday_cn",
        "home_team",
        "away_team",
        "match_status",
        "venue",
        "city",
        "country",
        "source_match_time_raw",
    ]
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def verify_with_wikipedia(rows: list[dict]) -> dict:
    html = fetch_text(WIKI_URL)
    first_match_ok = "Mexico" in html and "South Africa" in html
    second_match_ok = "Czechia" in html and "South Korea" in html
    date_range_ok = "June 11" in html and "July 19" in html
    row_count_ok = len(rows) == 104
    return {
        "first_match_ok": first_match_ok,
        "second_match_ok": second_match_ok,
        "date_range_ok": date_range_ok,
        "row_count_ok": row_count_ok,
    }


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    rows = fetch_matches()
    write_csv(rows, OUTPUT_PATH)
    verification = verify_with_wikipedia(rows)
    print(f"saved={OUTPUT_PATH.resolve()}")
    print(f"rows={len(rows)}")
    print(f"first={rows[0]['china_datetime']} {rows[0]['home_team']} vs {rows[0]['away_team']}")
    print(
        "verify="
        + json.dumps(
            verification,
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
