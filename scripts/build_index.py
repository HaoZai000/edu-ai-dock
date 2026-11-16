#!/usr/bin/env python3
"""把 index/root_index.yaml 与每所学校的 resources/{id}/adapters.yaml
编成客户端读取的 index/school_index.json。

只在内容真的变化时才重写，避免 CI 产生空提交。
"""
import datetime
import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
ROOT_INDEX = ROOT / "index" / "root_index.yaml"
OUT = ROOT / "index" / "school_index.json"
RESOURCES = ROOT / "resources"

PROTOCOL_VERSION = 1
CATEGORY = {
    "BACHELOR_AND_ASSOCIATE": 2,
    "POSTGRADUATE": 3,
    "GENERAL_TOOL": 1,
}
REQUIRED_ADAPTER_FIELDS = (
    "adapter_id",
    "adapter_name",
    "category",
    "asset_js_path",
    "maintainer",
    "description",
)


def fail(message):
    print(f"::error::{message}")
    sys.exit(1)


def load_yaml(path):
    if not path.exists():
        fail(f"缺少文件：{path.relative_to(ROOT)}")
    with path.open(encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def build_schools():
    root = load_yaml(ROOT_INDEX)
    schools = []
    seen_schools = set()

    for school in root.get("schools") or []:
        school_id = str(school.get("id") or "").strip()
        name = str(school.get("name") or "").strip()
        initial = str(school.get("initial") or "").strip().upper()

        if not school_id or not name or not initial:
            fail(f"root_index.yaml 的学校条目缺少 id / name / initial：{school}")
        if "/" in school_id or "\\" in school_id or ".." in school_id:
            fail(f"学校 id 不能包含路径字符：{school_id}")
        if school_id in seen_schools:
            fail(f"学校 id 重复：{school_id}")
        seen_schools.add(school_id)

        folder = RESOURCES / school_id
        declarations = load_yaml(folder / "adapters.yaml").get("adapters") or []
        if not declarations:
            fail(f"resources/{school_id}/adapters.yaml 至少要有一个适配器")

        adapters = []
        seen_adapters = set()
        for item in declarations:
            adapter_id = str(item.get("adapter_id") or "").strip()
            for field in REQUIRED_ADAPTER_FIELDS:
                if not str(item.get(field) or "").strip():
                    fail(f"{school_id} 的适配器 {adapter_id or '?'} 缺少字段 {field}")
            if adapter_id in seen_adapters:
                fail(f"{school_id} 的 adapter_id 重复：{adapter_id}")
            seen_adapters.add(adapter_id)

            category = str(item["category"]).strip().upper()
            if category not in CATEGORY:
                fail(f"{school_id}/{adapter_id} 的 category 不合法：{category}")

            script = str(item["asset_js_path"]).strip()
            if (
                "/" in script
                or "\\" in script
                or ".." in script
                or not script.endswith(".js")
            ):
                fail(f"{school_id}/{adapter_id} 的 asset_js_path 只能是同目录下的 .js 文件名：{script}")
            if not (folder / script).exists():
                fail(f"{school_id}/{adapter_id} 的脚本不存在：resources/{school_id}/{script}")

            adapters.append(
                {
                    "adapter_id": adapter_id,
                    "adapter_name": str(item["adapter_name"]).strip(),
                    "category": CATEGORY[category],
                    "asset_js_path": f"resources/{school_id}/{script}",
                    "import_url": str(item.get("import_url") or "").strip() or None,
                    "description": str(item["description"]).strip(),
                    "maintainer": str(item["maintainer"]).strip(),
                }
            )

        schools.append(
            {
                "id": school_id,
                "name": name,
                "initial": initial,
                "adapters": adapters,
            }
        )

    return schools


def main():
    schools = build_schools()

    if OUT.exists():
        try:
            previous = json.loads(OUT.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            previous = {}
    else:
        previous = {}

    if previous.get("protocol_version") == PROTOCOL_VERSION and previous.get("schools") == schools:
        print("索引无变化，跳过写入")
        return

    index = {
        "protocol_version": PROTOCOL_VERSION,
        "version_id": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "schools": schools,
    }
    OUT.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    adapter_count = sum(len(school["adapters"]) for school in schools)
    print(f"已生成 {OUT.relative_to(ROOT)}：{len(schools)} 所学校 / {adapter_count} 个适配器")


if __name__ == "__main__":
    main()
