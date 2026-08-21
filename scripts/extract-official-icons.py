# -*- coding: utf-8 -*-
"""从 claude.exe 的 PE 资源中提取所有图标并组装为标准多尺寸 ICO。"""
import struct
import sys

EXE = r"C:\Users\ASUS\AppData\Local\Microsoft\WinGet\Packages\Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe\claude.exe"
OUT = r"C:\Users\ASUS\AppData\Local\Temp\claude-official-full.ico"

data = open(EXE, "rb").read()
e_lfanew = struct.unpack_from("<I", data, 0x3C)[0]
assert data[e_lfanew:e_lfanew + 4] == b"PE\0\0"
coff = e_lfanew + 4
num_sections = struct.unpack_from("<H", data, coff + 2)[0]
opt_size = struct.unpack_from("<H", data, coff + 16)[0]
opt = coff + 20
magic = struct.unpack_from("<H", data, opt)[0]
dir_off = opt + (96 if magic == 0x10B else 112)
res_rva = struct.unpack_from("<I", data, dir_off + 2 * 8)[0]

# 节表：RVA -> file offset
sect = opt + opt_size
sections = []
for i in range(num_sections):
    s = sect + i * 40
    vsize, vaddr, rawsize, rawptr = struct.unpack_from("<IIII", data, s + 8)
    sections.append((vaddr, vsize, rawptr, rawsize))

def rva2off(rva):
    for vaddr, vsize, rawptr, rawsize in sections:
        if vaddr <= rva < vaddr + max(vsize, rawsize):
            return rawptr + (rva - vaddr)
    return None

def res_dir(rva):
    off = rva2off(rva)
    named, nid = struct.unpack_from("<HH", data, off + 12)
    entries = []
    for i in range(named + nid):
        name, offset = struct.unpack_from("<II", data, off + 16 + i * 8)
        entries.append((name, offset))
    return entries

def walk(rva, depth, path):
    """遍历资源树，收集 (路径ids, 数据RVA, 大小)。所有子目录/数据条目
    的偏移都相对于资源根 res_rva。"""
    out = []
    for name, offset in res_dir(rva):
        is_dir = offset & 0x80000000
        if is_dir:
            out += walk(res_rva + (offset & 0x7FFFFFFF), depth + 1, path + [name])
        else:
            data_entry = res_rva + offset
            d_rva, d_size = struct.unpack_from("<II", data, data_entry)
            out.append((path + [name], d_rva, d_size))
    return out

resources = walk(res_rva, 0, [])
group_icons = [r for r in resources if r[0][0] == 3]  # RT_GROUP_ICON
icon_entries = [r for r in resources if r[0][0] == 14]  # RT_ICON

# RT_ICON 原始数据（按资源 ID 索引）
icon_data = {}
for path, d_rva, d_size in icon_entries:
    icon_data[path[1]] = data[rva2off(d_rva):rva2off(d_rva) + d_size]

print(f"找到 {len(group_icons)} 个 GROUP_ICON, {len(icon_data)} 个 ICON 资源")

# 每个 GROUP_ICON 组装成一个 ICO 文件
for gi, (path, d_rva, d_size) in enumerate(group_icons):
    g = data[rva2off(d_rva):rva2off(d_rva) + d_size]
    count = struct.unpack_from("<H", g, 4)[0]
    imgs = []
    sizes = []
    for i in range(count):
        e = g[6 + i * 14:6 + (i + 1) * 14]
        w, h, colors, res, planes, bitcount, bytesinres, imgid = struct.unpack(
            "<BBBBHHIH", e)
        raw = icon_data.get(imgid)
        if raw is None:
            print(f"  [!] 缺 ID={imgid} 的位图")
            continue
        sizes.append((w or 256, h or 256, bitcount))
        imgs.append(raw)

    header = struct.pack("<HHH", 0, 1, len(imgs))
    offset = 6 + 16 * len(imgs)
    body = b""
    for i, raw in enumerate(imgs):
        w, h, bitcount = sizes[i]
        body += struct.pack("<BBBBHHII", w if w < 256 else 0, h if h < 256 else 0,
                            0, 0, 1, bitcount, len(raw), offset)
        offset += len(raw)
    ico = header + body + b"".join(imgs)

    if gi == 0:
        with open(OUT, "wb") as f:
            f.write(ico)
    print(f"GROUP_ICON[{gi}] 尺寸: {[f'{w}x{h}@{bc}' for w, h, bc in sizes]}")

print("保存:", OUT)
