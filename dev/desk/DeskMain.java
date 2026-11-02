import com.jogamp.opengl.*;
import io.stickmanup.gl.NRender;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.Path;

/** Replays a recorded mirror stream (dev/rec/*) through NRender on desktop OpenGL and writes a PNG. */
public class DeskMain {
    public static void main(String[] a) throws Exception {
        final Path dir = Path.of(a[0]);
        final String out = a[1];
        final int W = Integer.parseInt(System.getenv().getOrDefault("DW", "915")), H = Integer.parseInt(System.getenv().getOrDefault("DH", "412"));
        GLProfile.initSingleton();
        GLProfile p = GLProfile.get(GLProfile.GL4ES3);
        GLCapabilities caps = new GLCapabilities(p);
        caps.setDepthBits(24);
        GLOffscreenAutoDrawable d = GLDrawableFactory.getFactory(p).createOffscreenAutoDrawable(null, caps, null, W, H);
        d.addGLEventListener(new GLEventListener() {
            public void init(GLAutoDrawable dr) {}
            public void dispose(GLAutoDrawable dr) {}
            public void reshape(GLAutoDrawable dr, int x, int y, int w, int h) {}
            public void display(GLAutoDrawable dr) {
                GL4ES3 g = dr.getGL().getGL4ES3();
                NRender r = new NRender(new DeskGL(g), (png, wh) -> {
                    try {
                        BufferedImage im = ImageIO.read(new ByteArrayInputStream(png));
                        wh[0] = im.getWidth(); wh[1] = im.getHeight();
                        return im.getRGB(0, 0, wh[0], wh[1], null, 0, wh[0]);
                    } catch (Exception e) { throw new RuntimeException(e); }
                }, msg -> System.out.println("[nrender] " + msg));
                r.contextCreated();
                r.resize(W, H);
                try {
                    File[] files = dir.toFile().listFiles();
                    java.util.Arrays.sort(files);
                    for (File f : files) {
                        String kind = f.getName().contains("def") ? "def" : "frame";
                        r.post(kind, Files.readString(f.toPath()));
                    }
                } catch (Exception e) { throw new RuntimeException(e); }
                // RS=0.7 tests dynamic resolution (scene drawn smaller, scaled up in the final pass).
                r.renderScale = Float.parseFloat(System.getenv().getOrDefault("RS", "1"));
                // The first frames also compile shaders and upload everything, so they don't count.
                for (int k = 0; k < 40; k++) { r.draw(); g.glFinish(); }
                long t0 = System.nanoTime();
                for (int k = 0; k < 5; k++) { r.draw(); g.glFinish(); }
                System.out.println("draws " + r.draws + ", tris " + r.tris + ", " + (System.nanoTime() - t0) / 5_000_000 + " ms/frame (software GPU), GL error " + g.glGetError());
                ByteBuffer px = ByteBuffer.allocate(W * H * 4);
                g.glBindFramebuffer(GL.GL_FRAMEBUFFER, 0);
                g.glReadPixels(0, 0, W, H, GL.GL_RGBA, GL.GL_UNSIGNED_BYTE, px);
                BufferedImage img = new BufferedImage(W, H, BufferedImage.TYPE_INT_RGB);
                for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) {
                    int i = ((H - 1 - y) * W + x) * 4;
                    img.setRGB(x, y, ((px.get(i) & 255) << 16) | ((px.get(i + 1) & 255) << 8) | (px.get(i + 2) & 255));
                }
                try { ImageIO.write(img, "png", new File(out)); } catch (Exception e) { throw new RuntimeException(e); }
            }
        });
        d.display();
        d.destroy();
    }
}
