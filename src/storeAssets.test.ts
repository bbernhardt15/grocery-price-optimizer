import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function pngSize(buf: Buffer): { width: number; height: number; colorType: number } {
  assert.equal(buf.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(buf.subarray(12, 16).toString("ascii"), "IHDR");
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType: buf[25],
  };
}

test("store icon and splash come from the dark canvas mark", () => {
  const logo = readFileSync(new URL("../assets/logo.svg", import.meta.url), "utf8");
  assert.match(logo, /#1c221e/);
  assert.match(logo, /#7dcea0/);

  const icon = pngSize(
    readFileSync(new URL("../ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", import.meta.url))
  );
  assert.deepEqual({ width: icon.width, height: icon.height }, { width: 1024, height: 1024 });
  assert.equal(icon.colorType, 2, "App Store icon must be opaque RGB");

  const splash = pngSize(
    readFileSync(
      new URL("../ios/App/App/Assets.xcassets/Splash.imageset/Default@1x~universal~anyany.png", import.meta.url)
    )
  );
  assert.equal(splash.width, 2732);
  assert.equal(splash.height, 2732);

  const adaptive = readFileSync(
    new URL("../android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml", import.meta.url),
    "utf8"
  );
  assert.match(adaptive, /<adaptive-icon/);
  assert.match(adaptive, /ic_launcher_foreground/);
  assert.match(adaptive, /ic_launcher_background/);

  const foreground = pngSize(
    readFileSync(new URL("../android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png", import.meta.url))
  );
  assert.equal(foreground.width, 432);
  assert.equal(foreground.height, 432);

  const config = readFileSync(new URL("../capacitor.config.ts", import.meta.url), "utf8");
  assert.match(config, /backgroundColor: "#1c221e"/);
  const storyboard = readFileSync(
    new URL("../ios/App/App/Base.lproj/LaunchScreen.storyboard", import.meta.url),
    "utf8"
  );
  assert.match(storyboard, /0\.10980392156862745/);
  assert.equal(storyboard.includes("0.47843137254901963"), false);
});
