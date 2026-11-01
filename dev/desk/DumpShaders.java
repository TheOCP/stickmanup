import io.stickmanup.gl.NRender;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;

/** Writes every shader NRender would compile for a recording to OUT/*.vert|frag, for glslangValidator. */
public class DumpShaders {
    public static void main(String[] a) throws Exception {
        NRender r = new NRender(null, null, msg -> System.out.println(msg));
        File[] files = new File(a[0]).listFiles();
        java.util.Arrays.sort(files);
        for (File f : files) if (f.getName().contains("def")) r.post("def", Files.readString(f.toPath()));
        Path out = Path.of(a[1]);
        Files.createDirectories(out);
        for (String[] s : r.allSources()) {
            Files.writeString(out.resolve(s[0] + ".vert"), s[1]);
            Files.writeString(out.resolve(s[0] + ".frag"), s[2]);
        }
    }
}
