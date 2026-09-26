/*
 * LabelPatcher -- inject a per-frame "world-anchored text label" system into the engine.
 *
 * Goal (T4): draw a viewer's NAME over their representative unit.
 *
 * Design (lowest-risk):
 *   - The script supplies world coords (the relay already knows where it spawned the unit),
 *     so we do NOT depend on per-unit position FIELD names (eo/ep live in a superclass and
 *     the two decompilations disagree on obfuscation mapping -- avoid that risk entirely).
 *   - We add label storage + a draw routine to the Debug script class, and hook the
 *     per-frame tail j()V of com.corrodinggames.rts.gameFramework.f.g (same mount the
 *     econ injection uses; verified: f.g.b(F)V calls this.j() and j()V is near-empty).
 *
 * Verified decompile anchors (war-vote/tools/_gfdec/gf_src/...):
 *   l.java:179   public com.corrodinggames.rts.gameFramework.m.y bO;      <- the text-draw context
 *   m/y.java:90  public void a(String, float, float, Paint);              <- desc (Ljava/lang/String;FFLandroid/graphics/Paint;)V
 *   l.java:213   public float cw;  l.java:214 public float cx;            <- camera world offset
 *   l.java:240   public float cX = 1.0f;                                  <- render scale used by projection
 *   f/g.java:1052 public void b(float)  ... this.j();   f/g.java:1128 public void j()  <- per-frame hook
 *   Projection is inline in the engine:  screen = (world - cam) * scale
 *   android/graphics/Paint() default: color field n = -1 (white), textSize q = 16.0f  (Paint.java a()/fields)
 *
 * Idempotency: adds marker __labelV1() to Debug; refuses to run if already present.
 * Build (no JDK; game JRE 8 + ECJ + javassist): see build.ps1 next to this file.
 */

import javassist.ClassPool;
import javassist.CtClass;
import javassist.CtField;
import javassist.CtMethod;
import javassist.CtNewMethod;
import javassist.NotFoundException;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.PrintWriter;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.HashSet;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

public class LabelPatcher {

    static final String CLS_G     = "com.corrodinggames.rts.gameFramework.f.g";
    static final String CLS_DEBUG = "com.corrodinggames.librocket.scripts.Debug";

    static final StringBuilder LOG = new StringBuilder();
    static void log(String s) { LOG.append(s).append('\n'); System.out.println(s); }

    public static void main(String[] args) {
        String inJar = null, outDir = null;
        for (int i = 0; i < args.length; i++) {
            if ("--in".equals(args[i]) && i + 1 < args.length) inJar = args[++i];
            else if ("--out".equals(args[i]) && i + 1 < args.length) outDir = args[++i];
        }
        if (inJar == null || outDir == null) {
            System.err.println("usage: LabelPatcher --in <game-lib.jar> --out <outdir>");
            System.exit(2);
        }
        try { run(inJar, outDir); } catch (Throwable t) {
            log("FATAL: " + t); t.printStackTrace(System.out); flushLog(outDir); System.exit(1);
        }
        flushLog(outDir);
        System.exit(0);
    }

    static void flushLog(String outDir) {
        try {
            File d = new File(outDir); if (!d.exists()) d.mkdirs();
            PrintWriter pw = new PrintWriter(new FileOutputStream(new File(d, "patch.log")), true);
            pw.print(LOG.toString()); pw.close();
        } catch (IOException e) { System.err.println("could not write patch.log: " + e); }
    }

    static void run(String inJar, String outDir) throws Exception {
        File inJarF = new File(inJar);
        if (!inJarF.isFile()) throw new IOException("input jar not found: " + inJarF.getAbsolutePath());
        File outDirF = new File(outDir);
        File classesDir = new File(outDirF, "classes");
        classesDir.mkdirs();

        log("=== LabelPatcher ===");
        log("input jar : " + inJarF.getAbsolutePath() + "  (" + inJarF.length() + " bytes)");

        ClassPool pool = new ClassPool(true);
        pool.appendClassPath(inJarF.getAbsolutePath());

        // ---- 0. input guard ----
        CtClass cDbg = pool.get(CLS_DEBUG);
        boolean already = false;
        try { cDbg.getDeclaredMethod("__labelV1"); already = true; } catch (NotFoundException nfe) { already = false; }
        if (already) { log("FAIL Debug already has __labelV1 -- input already labeled"); throw new IOException("input already labeled"); }
        log("OK  input is clean (no __labelV1)");

        // ---- 1. verify the APIs we depend on ----
        CtClass cL = pool.get("com.corrodinggames.rts.gameFramework.l");
        CtClass cG = pool.get(CLS_G);
        CtClass cGin = pool.get("com.corrodinggames.rts.gameFramework.m.y");
        log("OK  " + CLS_G + " found");
        log("OK  " + cGin.getName() + ".a(String,float,float,Paint) = "
            + cGin.getMethod("a", "(Ljava/lang/String;FFLandroid/graphics/Paint;)V").getSignature());
        CtMethod mJ = cG.getDeclaredMethod("j", new CtClass[0]);
        log("OK  " + CLS_G + ".j() " + mJ.getSignature() + "  (per-frame hook point)");
        CtField fCw = cL.getField("cw"); CtField fCx = cL.getField("cx"); CtField fCX = cL.getField("cX");
        CtField fBO = cL.getField("bO");
        log("OK  l.cw " + fCw.getType().getName() + " / l.cx " + fCx.getType().getName()
            + " / l.cX " + fCX.getType().getName() + " / l.bO " + fBO.getType().getName());

        // ---- 2. add static storage + methods to Debug ----
        CtField labels = CtField.make("public static java.util.ArrayList LABELS = new java.util.ArrayList();", cDbg);
        cDbg.addField(labels);
        cDbg.addField(CtField.make("public static java.util.ArrayList PLACED = new java.util.ArrayList();", cDbg));
        cDbg.addField(CtField.make("public static java.util.HashMap AVATARS = new java.util.HashMap();", cDbg));
        log("OK  added Debug.LABELS / PLACED / AVATARS");

        // verify the image-draw APIs we rely on for per-viewer avatars
        log("OK  m.y texture-load a(InputStream,boolean) = "
            + cGin.getMethod("a", "(Ljava/io/InputStream;Z)Lcom/corrodinggames/rts/gameFramework/m/e;").getSignature());
        log("OK  m.y texture-draw  a(m.e,float,float,Paint) = "
            + cGin.getMethod("a", "(Lcom/corrodinggames/rts/gameFramework/m/e;FFLandroid/graphics/Paint;)V").getSignature());

        String addSrc =
              "public void addLabel(java.lang.String s, float wx, float wy) {\n"
            + "  if (s == null) return;\n"
            + "  com.corrodinggames.librocket.scripts.Debug.LABELS.add(new java.lang.Object[]{ s, new java.lang.Float(wx), new java.lang.Float(wy) });\n"
            + "}\n";
        cDbg.addMethod(CtNewMethod.make(addSrc, cDbg));
        log("OK  added Debug.addLabel(String,float,float)");

        // per-viewer avatar: place a PNG (by absolute path) at a world coord; drawn each frame.
        String avSrc =
              "public void addAvatar(java.lang.String path, float wx, float wy) {\n"
            + "  if (path == null) return;\n"
            + "  com.corrodinggames.librocket.scripts.Debug.PLACED.add(new java.lang.Object[]{ path, new java.lang.Float(wx), new java.lang.Float(wy) });\n"
            + "}\n";
        cDbg.addMethod(CtNewMethod.make(avSrc, cDbg));
        log("OK  added Debug.addAvatar(String,float,float)");

        String clearSrc =
              "public void clearLabels() {\n"
            + "  com.corrodinggames.librocket.scripts.Debug.LABELS.clear();\n"
            + "  com.corrodinggames.librocket.scripts.Debug.PLACED.clear();\n"
            + "}\n";
        cDbg.addMethod(CtNewMethod.make(clearSrc, cDbg));
        log("OK  added Debug.clearLabels()");

        // draw: project each stored world coord; draw text and (cached) avatar textures there. Never throws.
        String drawSrc =
              "public static void drawLabels() {\n"
            + "  try {\n"
            + "    com.corrodinggames.rts.gameFramework.l L = com.corrodinggames.rts.gameFramework.l.B();\n"
            + "    if (L == null || L.bO == null) return;\n"
            + "    java.util.ArrayList ls = com.corrodinggames.librocket.scripts.Debug.LABELS;\n"
            + "    int i = 0;\n"
            + "    while (i < ls.size()) {\n"
            + "      java.lang.Object[] o = (java.lang.Object[]) ls.get(i);\n"
            + "      java.lang.String s = (java.lang.String) o[0];\n"
            + "      float wx = ((java.lang.Float) o[1]).floatValue();\n"
            + "      float wy = ((java.lang.Float) o[2]).floatValue();\n"
            + "      float sx = (wx - L.cw) * L.cX;\n"
            + "      float sy = (wy - L.cx) * L.cX;\n"
            + "      android.graphics.Paint p = new android.graphics.Paint();\n"
            + "      L.bO.a(s, sx, sy, p);\n"
            + "      i = i + 1;\n"
            + "    }\n"
            + "    java.util.ArrayList pl = com.corrodinggames.librocket.scripts.Debug.PLACED;\n"
            + "    java.util.HashMap cache = com.corrodinggames.librocket.scripts.Debug.AVATARS;\n"
            + "    int k = 0;\n"
            + "    while (k < pl.size()) {\n"
            + "      java.lang.Object[] o = (java.lang.Object[]) pl.get(k);\n"
            + "      java.lang.String path = (java.lang.String) o[0];\n"
            + "      float wx = ((java.lang.Float) o[1]).floatValue();\n"
            + "      float wy = ((java.lang.Float) o[2]).floatValue();\n"
            + "      com.corrodinggames.rts.gameFramework.m.e tex = (com.corrodinggames.rts.gameFramework.m.e) cache.get(path);\n"
            + "      if (tex == null) {\n"
            + "        try { tex = L.bO.a(new java.io.FileInputStream(path), true); cache.put(path, tex); }\n"
            + "        catch (Throwable t2) { tex = null; cache.put(path, null); }\n"
            + "      }\n"
            + "      if (tex != null) {\n"
            + "        float sx = (wx - L.cw) * L.cX;\n"
            + "        float sy = (wy - L.cx) * L.cX;\n"
            + "        L.bO.a(tex, sx, sy, new android.graphics.Paint());\n"
            + "      }\n"
            + "      k = k + 1;\n"
            + "    }\n"
            + "  } catch (Throwable t) { }\n"
            + "}\n";
        cDbg.addMethod(CtNewMethod.make(drawSrc, cDbg));
        log("OK  added Debug.drawLabels() (text + avatar)");

        // ---- T5: 按 key 记录代表单位 id，并可按 key 删（换阵营删旧单位）----
        cDbg.addField(CtField.make("public static java.util.HashMap REPIDS = new java.util.HashMap();", cDbg));
        String spawnRepSrc =
              "public void spawnRep(java.lang.String type, float x, float y, int team, java.lang.String key) {\n"
            + "  try {\n"
            + "    java.lang.Long id = this.createUnit(type, x, y, team, false);\n"
            + "    if (id != null && key != null) { com.corrodinggames.librocket.scripts.Debug.REPIDS.put(key, id); }\n"
            + "  } catch (Throwable t) { }\n"
            + "}\n";
        cDbg.addMethod(CtNewMethod.make(spawnRepSrc, cDbg));
        String removeRepSrc =
              "public void removeRep(java.lang.String key) {\n"
            + "  try {\n"
            + "    java.lang.Object o = com.corrodinggames.librocket.scripts.Debug.REPIDS.get(key);\n"
            + "    if (o == null) return;\n"
            + "    long id = ((java.lang.Long)o).longValue();\n"
            + "    com.corrodinggames.rts.game.units.y u = com.corrodinggames.rts.gameFramework.w.b(id, true);\n"
            + "    if (u != null) { u.cu = -1.0f; }\n"
            + "    com.corrodinggames.librocket.scripts.Debug.REPIDS.remove(key);\n"
            + "  } catch (Throwable t) { }\n"
            + "}\n";
        cDbg.addMethod(CtNewMethod.make(removeRepSrc, cDbg));
        log("OK  added Debug.spawnRep / Debug.removeRep (keyed by viewer key)");

        // ---- 3. hook the per-frame tail ----
        mJ.insertBefore("com.corrodinggames.librocket.scripts.Debug.drawLabels();");
        log("OK  hooked " + CLS_G + ".j()V -> Debug.drawLabels()");

        // ---- 3b. idempotency marker ----
        cDbg.addMethod(CtNewMethod.make("public static String __labelV1() { return \"label-V1\"; }\n", cDbg));
        log("OK  added marker Debug.__labelV1()");

        // ---- 4. write classes ----
        Map<String, byte[]> repl = new LinkedHashMap<String, byte[]>();
        repl.put(cDbg.getName().replace('.', '/') + ".class", cDbg.toBytecode());
        repl.put(cG.getName().replace('.', '/') + ".class", cG.toBytecode());
        for (Map.Entry<String, byte[]> e : repl.entrySet()) {
            File f = new File(classesDir, e.getKey());
            File parent = f.getParentFile(); if (parent != null) parent.mkdirs();
            FileOutputStream fos = new FileOutputStream(f); fos.write(e.getValue()); fos.close();
            log("WROTE " + f.getAbsolutePath() + "  (" + f.length() + " bytes)");
        }

        // ---- 5. rewrite jar ----
        File patchedJar = new File(outDirF, "game-lib.patched.jar");
        rewriteJar(inJarF, patchedJar, repl);
        log("WROTE " + patchedJar.getAbsolutePath() + "  (" + patchedJar.length() + " bytes)");
        log("PATCH-SUMMARY OK");
    }

    static void rewriteJar(File inJar, File outJar, Map<String, byte[]> repl) throws IOException {
        Set<String> written = new HashSet<String>();
        byte[] buf = new byte[8192];
        ZipInputStream zis = new ZipInputStream(new FileInputStream(inJar));
        ZipOutputStream zos = new ZipOutputStream(new FileOutputStream(outJar));
        try {
            ZipEntry e;
            while ((e = zis.getNextEntry()) != null) {
                String name = e.getName();
                ZipEntry ne = new ZipEntry(name);
                if (e.getTime() != -1) ne.setTime(e.getTime());
                zos.putNextEntry(ne);
                byte[] r = repl.get(name);
                if (r != null) { zos.write(r, 0, r.length); }
                else { int n; while ((n = zis.read(buf)) > 0) zos.write(buf, 0, n); }
                zos.closeEntry(); zis.closeEntry(); written.add(name);
            }
            for (Map.Entry<String, byte[]> me : repl.entrySet()) {
                if (written.contains(me.getKey())) continue;
                ZipEntry ne = new ZipEntry(me.getKey());
                zos.putNextEntry(ne); zos.write(me.getValue(), 0, me.getValue().length); zos.closeEntry();
                written.add(me.getKey());
            }
        } finally { try { zis.close(); } catch (IOException ignore) {} zos.close(); }
    }
}
