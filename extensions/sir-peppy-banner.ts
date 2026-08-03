import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";

// Ascii pepperoni
const banner = [
`                    ▄▄▄▄▄▄▄▄▄
                ▄▄█▀▀         ▀▀█▄▄
             ▄█▀   ░   ░   ░   ░   ▀█▄
           ▄█▀   ░                 ░  ▀█▄
          █▀   ░   ░             ░  ░    ▀█
         █▀  ░  ░   ██         ██  ░   ░  ▀█
        █▀  ░   ░   ██         ██ ░    ░   ▀█
        █  ░  ░  ▓▒   █       █   ▓▒ ░   ░  █
        █  ░     ▓▒   ▀▄▄▄▄▄▄▀    ▓▒   ░ ░  █
        █  ░  ░    ░            ░    ░   ░  █
        █▀   ░   ░   ░    ░    ░   ░   ░   ▀█
         █▄   ░   ░    ░    ░    ░   ░    ▄█
          ▀█▄   ░   ░    ░    ░    ░   ░▄█▀
            ▀█▄▄   ░   ░    ░   ░  ▄▄█▀
               ▀▀█▄▄▄▄▄▄▄▄▄▄▄▄▄█▀▀

                 [Sir Peppy]
`
]
const GRADIENT = ["warning"] as const;

class SirPeppyBanner {
    private lines = banner[0].split("\n");
    constructor(private theme: any) {}

    render(width: number): string[] {
        return this.lines.map((line, index) => {
            return this.theme.fg(GRADIENT[index % GRADIENT.length], line);
        });
    }
    invalidate(): void {}
}

export default function (pi: ExtensionAPI) {
    pi.registerEntryRenderer("sir-peppy-banner", (entry, { expanded }, theme) => {
        const lines = banner[0].split("\n");
        const box = new Box(0, 0);
        lines.forEach((line, index) => {
            box.addChild(new Text(theme.fg(GRADIENT[index % GRADIENT.length], line), 0,0));
        });
        return box;
    });

     pi.on("session_start", async (event, ctx) => {
        pi.appendEntry("sir-peppy-banner");
    });
}
