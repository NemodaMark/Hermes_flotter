"""Render exact ranges from the pinned HERMES source snapshot."""
import hashlib
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from pygments import lex
from pygments.lexers import get_lexer_by_name
from pygments.styles import get_style_by_name

REVISION = "9421b69278601c8b7e73d032f88858dbc0bb4f2e"
TOOLS = Path(__file__).resolve().parent
REPO = TOOLS.parents[2]
CODE = TOOLS.parent / "code"
GITHUB = f"https://github.com/NemodaMark/Hermes_flotter/blob/{REVISION}"
STYLE = get_style_by_name("friendly")
WIDTH = 108


def render(snippet, source, language):
    characters = [
        (character, STYLE.style_for_token(kind)["color"] or "24292f")
        for kind, value in lex(source, get_lexer_by_name(language, stripnl=False))
        for character in value
    ]
    rows = [[]]
    for character, color in characters:
        if character == "\n":
            rows.append([])
        elif character == "\t":
            rows[-1].extend([(" ", color)] * (4 - len(rows[-1]) % 4))
        else:
            rows[-1].append((character, color))
    rows.pop()
    displayed = []
    for number, row in enumerate(rows, snippet["from"]):
        for start in range(0, max(1, len(row)), WIDTH):
            marker = str(number) if start == 0 else "+"
            displayed.append((marker, row[start:start + WIDTH]))

    font = ImageFont.truetype("consola.ttf", 20)
    header = ImageFont.truetype("consolab.ttf", 22)
    small = ImageFont.truetype("consola.ttf", 16)
    pitch = font.getlength("M")
    margin, row_height, start_y = 30, 27, 123
    image = Image.new("RGB", (round(110 + WIDTH * pitch + margin), start_y + len(displayed) * row_height + 22), "#f7f8fa")
    draw = ImageDraw.Draw(image)
    draw.text((margin, 21), snippet["title"], fill="#182331", font=header)
    draw.text((margin, 54), f'{snippet["path"]}   {snippet["from"]}-{snippet["to"]}', fill="#404b59", font=small)
    draw.text((margin, 79), "9421b69  ·  + ugyanannak a forrássornak a folytatása", fill="#404b59", font=small)
    draw.line((margin, 108, image.width - margin, 108), fill="#cdd6df", width=1)
    for index, (number, letters) in enumerate(displayed):
        top = start_y + index * row_height
        draw.text((margin, top), number.rjust(4), font=small, fill="#526273")
        for offset, (character, color) in enumerate(letters):
            draw.text((100 + offset * pitch, top), character, font=font, fill="#" + color)
    image.save(CODE / (snippet["id"] + ".png"), optimize=True)


def main():
    snippets = json.loads((TOOLS / "snippets.json").read_text(encoding="utf-8"))
    for snippet in snippets:
        path = snippet["path"]
        first, last = snippet["from"], snippet["to"]
        source = subprocess.check_output(["git", "show", f"{REVISION}:{path}"], cwd=REPO).decode("utf-8-sig")
        excerpt = "\n".join(source.splitlines()[first - 1:last]) + "\n"
        assert len(excerpt.splitlines()) == last - first + 1
        digest = hashlib.sha256(excerpt.encode("utf-8")).hexdigest()
        language = "tsx" if path.endswith(".tsx") else "csharp"
        render(snippet, excerpt, language)
        content = (
            f'# {snippet["title"]}\n\n'
            f'![{snippet["title"]}]({snippet["id"]}.png)\n\n'
            f'**Forrás** [{path}, {first}–{last}. sor]({GITHUB}/{path}#L{first}-L{last}). '
            f'**Azonosító** `{snippet["symbol"]}`. '
            f'**Javasolt fejezet** {snippet["chapter"]}.\n\n'
            f'**Működés.** {snippet["logic"]}\n\n'
            f'**Kapcsolatok.** {snippet["links"]}\n\n'
            f'**Korlát.** {snippet["limits"]}\n\n'
            f'**Kivágás.** {snippet["crop"]} A képen a `+` vizuális sortörést jelöl ugyanazon forrássoron belül.\n\n'
            f'```{language}\n{excerpt}```\n\n'
            f'**A másolható részlet SHA-256 lenyomata** `{digest}` (UTF-8, LF).\n'
        )
        (CODE / (snippet["id"] + ".md")).write_text(content, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
