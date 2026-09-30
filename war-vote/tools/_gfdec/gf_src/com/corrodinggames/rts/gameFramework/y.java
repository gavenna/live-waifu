/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  com.corrodinggames.rts.game.a.a
 *  com.corrodinggames.rts.game.c
 *  com.corrodinggames.rts.game.e
 *  com.corrodinggames.rts.game.f
 *  com.corrodinggames.rts.game.l
 *  com.corrodinggames.rts.game.n
 *  com.corrodinggames.rts.game.units.am
 *  com.corrodinggames.rts.game.units.ar
 *  com.corrodinggames.rts.game.units.as
 *  com.corrodinggames.rts.game.units.custom.ag
 *  com.corrodinggames.rts.game.units.custom.bd
 *  com.corrodinggames.rts.game.units.custom.l
 *  com.corrodinggames.rts.game.units.h
 *  com.corrodinggames.rts.game.units.y
 */
package com.corrodinggames.rts.gameFramework;

import com.corrodinggames.rts.game.c;
import com.corrodinggames.rts.game.e;
import com.corrodinggames.rts.game.n;
import com.corrodinggames.rts.game.units.am;
import com.corrodinggames.rts.game.units.ar;
import com.corrodinggames.rts.game.units.custom.ag;
import com.corrodinggames.rts.game.units.custom.bd;
import com.corrodinggames.rts.game.units.h;
import com.corrodinggames.rts.gameFramework.br;
import com.corrodinggames.rts.gameFramework.bs;
import com.corrodinggames.rts.gameFramework.e.a;
import com.corrodinggames.rts.gameFramework.j.ad;
import com.corrodinggames.rts.gameFramework.j.as;
import com.corrodinggames.rts.gameFramework.j.aw;
import com.corrodinggames.rts.gameFramework.j.k;
import com.corrodinggames.rts.gameFramework.l;
import com.corrodinggames.rts.gameFramework.n.f;
import com.corrodinggames.rts.gameFramework.s;
import com.corrodinggames.rts.gameFramework.utility.j;
import com.corrodinggames.rts.gameFramework.utility.o;
import com.corrodinggames.rts.gameFramework.w;
import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.EOFException;
import java.io.File;
import java.io.FilterOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.PrintStream;
import java.util.ArrayList;
import java.util.Iterator;

public strictfp class y {
    public static boolean a = false;
    final boolean b;
    int c;
    int d;

    public y() {
        if (!l.as) {
            // empty if block
        }
        this.b = false;
        this.c = -9999;
        this.d = -9999;
    }

    public File a(String string, boolean bl2) {
        return y.a(string, "saves/", bl2);
    }

    public static File a(String string, String string2, boolean bl2) {
        return com.corrodinggames.rts.gameFramework.e.a.a(string, string2, bl2);
    }

    /*
     * WARNING - Removed try catching itself - possible behaviour change.
     */
    public void b(String string, boolean bl2) {
        boolean bl3;
        l l2;
        block21: {
            l2 = l.B();
            String string2 = string;
            if (string2 != null && !string2.endsWith(".rwsave")) {
                string2 = string2 + ".rwsave";
            }
            String string3 = "SD card";
            File file = null;
            bl3 = false;
            try {
                FilterOutputStream filterOutputStream;
                file = this.a(string2 + ".tmp", true);
                if (file.exists()) {
                    file = this.a(string2 + ".tmp2", true);
                }
                File file2 = this.a(string2, true);
                string3 = file2.getAbsolutePath();
                l.e("Saving game to: " + string3);
                OutputStream outputStream = com.corrodinggames.rts.gameFramework.e.a.a(file, false);
                BufferedOutputStream bufferedOutputStream = new BufferedOutputStream(outputStream);
                if (!a) {
                    filterOutputStream = new DataOutputStream(bufferedOutputStream);
                    as as2 = new as((DataOutputStream)filterOutputStream);
                    try {
                        this.a(as2);
                    }
                    finally {
                        filterOutputStream.close();
                        bufferedOutputStream.close();
                        outputStream.close();
                    }
                }
                filterOutputStream = new PrintStream(bufferedOutputStream);
                aw aw2 = new aw((PrintStream)filterOutputStream);
                try {
                    this.a(aw2);
                }
                finally {
                    ((PrintStream)filterOutputStream).close();
                    bufferedOutputStream.close();
                    outputStream.close();
                }
                l.n("DEBUG plain text save created");
                if (bl2 && l.at() && com.corrodinggames.rts.gameFramework.e.a.i(file2.getAbsolutePath())) {
                    l.e("Autosave file already exists: " + file2.getAbsolutePath());
                    boolean bl4 = com.corrodinggames.rts.gameFramework.e.a.b(file2);
                    if (!bl4) {
                        l.e("Old autosave failed to delete");
                    }
                }
                l.e("Finished writing save, renaming to final filename");
                boolean bl5 = com.corrodinggames.rts.gameFramework.e.a.b(file, file2);
                if (!bl5) {
                    l.e("Failed to rename to final file");
                    throw new IOException("Failed to rename to final file. Check file permissions of storage.");
                }
                com.corrodinggames.rts.gameFramework.e.a.c(file2);
                bl3 = true;
            }
            catch (Exception exception) {
                if (bl2) {
                    l.e("Auto save failed: " + exception.getMessage());
                    return;
                }
                exception.printStackTrace();
                String string4 = com.corrodinggames.rts.gameFramework.f.b(exception);
                String string5 = "Error saving game, please check permissions, disk space, etc. (" + string4 + ")";
                l2.a(string5, 1);
                if (file != null && com.corrodinggames.rts.gameFramework.e.a.i(file.getAbsolutePath())) {
                    l.e("saveGame: Removing temp save file after crash");
                    com.corrodinggames.rts.gameFramework.e.a.b(file);
                }
            }
            catch (OutOfMemoryError outOfMemoryError) {
                outOfMemoryError.printStackTrace();
                String string6 = "Error. Run out of memory error while saving game to " + string3 + ".";
                l2.a(string6, 1);
                if (file == null || !com.corrodinggames.rts.gameFramework.e.a.i(file.getAbsolutePath())) break block21;
                l.e("saveGame: Removing temp save file after crash");
                com.corrodinggames.rts.gameFramework.e.a.b(file);
            }
        }
        if (bl3) {
            if (bl2) {
                l2.bS.i.a("Auto Saved", 1000);
            } else {
                l2.bS.h.a(null, "Game saved");
            }
        }
    }

    /*
     * WARNING - void declaration
     * Enabled force condition propagation
     * Lifted jumps to return sites
     */
    public void a(as as2) {
        l l2 = l.B();
        long l3 = System.currentTimeMillis();
        l.b("GameSaver", "saveCurrentMap took:" + (System.currentTimeMillis() - l3));
        long l4 = System.currentTimeMillis();
        try {
            Object object2;
            as2.c("rustedWarfareSave");
            int n2 = l2.c(true);
            as2.a(n2);
            as2.a(96);
            as2.a(l2.ar);
            as2.a("saveCompression", true);
            as2.e("customUnitsBlock");
            com.corrodinggames.rts.game.units.custom.l.a((as)as2);
            as2.a("customUnitsBlock");
            as2.e("gameSetup");
            boolean bl2 = l2.bX.B || l2.bX.F;
            as2.a(l2.bX.B);
            as2.a(l2.bX.F);
            as2.a(bl2);
            if (bl2) {
                l2.bX.a(as2);
            }
            as2.a("gameSetup");
            as2.c(l2.dl);
            boolean bl3 = l2.dm != null;
            as2.a(bl3);
            if (bl3) {
                l.e("Writing remote map steam into save");
                as2.a(l2.dm);
            }
            as2.a(l2.by);
            as2.a(l2.cy + l2.cI);
            as2.a(l2.cz + l2.cJ);
            as2.a(l2.cV);
            as2.a(l2.bV.a);
            as2.a(0);
            as2.e();
            l2.bL.a(as2);
            as2.a(l2.bv);
            as2.a(l2.bL.E);
            as2.a(l2.bL.F);
            as2.a(l2.bL.G);
            as2.a(l2.ce != null);
            if (l2.ce != null) {
                l2.ce.a(as2);
            }
            as2.e();
            int n3 = -1;
            if (l2.bs != null) {
                n3 = l2.bs.k;
            }
            as2.a(n3);
            as2.a(n.c);
            for (int i2 = 0; i2 < n.c; ++i2) {
                object2 = n.k((int)i2);
                as2.a(object2 instanceof com.corrodinggames.rts.game.a.a);
                as2.a(object2 instanceof c);
                as2.a(object2 != null);
                if (object2 == null) continue;
                object2.b(as2);
            }
            if (!l2.bS.e) {
                // empty if block
            }
            as2.d("Section: unit shells");
            as2.a(w.er.size());
            for (Object object2 : w.er) {
                if (object2 == null) {
                    throw new RuntimeException("Found null in fastGameObjectList");
                }
                if (object2 instanceof am) {
                    am am2 = (am)object2;
                    if (am2.r() instanceof ar) {
                        as2.c(1);
                        as2.a((Enum)((ar)am2.r()));
                    } else {
                        if (!(am2.r() instanceof com.corrodinggames.rts.game.units.custom.l)) throw new IOException("Unhandled getUnitType on save:" + am2.r().getClass().toString());
                        as2.c(3);
                        String string = ((com.corrodinggames.rts.game.units.custom.l)am2.r()).M;
                        as2.c(string);
                    }
                } else {
                    as2.c(2);
                    if (object2 instanceof com.corrodinggames.rts.game.l) {
                        as2.c(1);
                    } else if (object2 instanceof com.corrodinggames.rts.game.f) {
                        as2.c(2);
                    } else if (object2 instanceof com.corrodinggames.rts.gameFramework.d.f) {
                        as2.c(3);
                    } else {
                        void var13_18;
                        Object var13_16 = null;
                        if (object2.getClass() == null) throw new IOException("Unhandled class on save: " + (String)var13_18);
                        String string = object2.getClass().toString();
                        throw new IOException("Unhandled class on save: " + (String)var13_18);
                    }
                }
                as2.a(((w)object2).eh);
            }
            as2.d("Section: CurrentUnitId");
            as2.a(l2.bX.z());
            l2.bV.a(as2);
            l2.bS.a(as2);
            l2.bY.a(as2);
            for (int i3 = 0; i3 < n.c; ++i3) {
                object2 = n.k((int)i3);
                if (object2 == null) continue;
                object2.a(as2);
            }
            as2.e();
            for (Object object2 : w.er) {
                if (as2.f()) {
                    void var13_22;
                    String string = object2.getClass().getSimpleName();
                    if (object2 instanceof am) {
                        String string2 = ((am)object2).r().i();
                    }
                    as2.d("Saving unit:" + (String)var13_22 + " (id" + ((w)object2).eh + ")");
                }
                ((w)object2).a(as2);
                as2.e();
            }
            as2.a("saveCompression");
            as2.e();
            as2.c("<SAVE END>");
        }
        catch (IOException iOException) {
            iOException.printStackTrace();
            throw iOException;
        }
        l.b("GameSaver", "saveGame took:" + (System.currentTimeMillis() - l4));
    }

    public String a(String string) {
        if (string == null) {
            return null;
        }
        if (string.equals("maps/normal/l010;mission_1__-__Dividing_River.tmx")) {
            return "maps/normal/l010;[demo]mission_1__-__Dividing_River.tmx";
        }
        if (string.equals("maps/normal/l030;mission_3__-__Crossfire.tmx")) {
            return "maps/normal/l030;[demo]mission_3__-__Crossfire.tmx";
        }
        return string;
    }

    /*
     * WARNING - Removed try catching itself - possible behaviour change.
     */
    public boolean c(String string, boolean bl2) {
        boolean bl3;
        l l2 = l.B();
        File file = this.a(string, false);
        if (file.isDirectory()) {
            l2.a("Could not load, is a directory", 1);
            return false;
        }
        j j2 = com.corrodinggames.rts.gameFramework.e.a.k(file.getAbsolutePath());
        if (j2 == null) {
            l2.a("Could not load, failed to open: " + com.corrodinggames.rts.gameFramework.e.a.d(file.getAbsolutePath()), 1);
            return false;
        }
        BufferedInputStream bufferedInputStream = new BufferedInputStream(j2);
        DataInputStream dataInputStream = new DataInputStream(bufferedInputStream);
        k k2 = new k(dataInputStream);
        try {
            bl3 = this.a(k2, bl2, false, false);
        }
        catch (Throwable throwable) {
            try {
                dataInputStream.close();
                bufferedInputStream.close();
                ((InputStream)j2).close();
                throw throwable;
            }
            catch (Exception exception) {
                throw new RuntimeException(exception);
            }
        }
        dataInputStream.close();
        bufferedInputStream.close();
        ((InputStream)j2).close();
        return bl3;
    }

    public void a(String string, as as2) {
        File file = this.a(string, false);
        if (file == null) {
            throw new IOException("Failed to get game save: " + string);
        }
        as2.a(file);
    }

    /*
     * WARNING - Removed try catching itself - possible behaviour change.
     * WARNING - void declaration
     * Enabled force condition propagation
     * Lifted jumps to return sites
     */
    public synchronized boolean a(k k2, boolean bl2, boolean bl3, boolean bl4) {
        l l2 = l.B();
        try {
            boolean bl5;
            String string;
            br br2 = l2.cd;
            if (this.b) {
                br2.a(bs.y);
            }
            ArrayList<Long> arrayList = null;
            if (bl4) {
                arrayList = new ArrayList<Long>();
                for (am am2 : l2.bS.bZ) {
                    arrayList.add(am2.eh);
                }
            }
            try {
                string = k2.l();
            }
            catch (EOFException eOFException) {
                eOFException.printStackTrace();
                String string2 = "Failed to load save. (End of file trying to read header)";
                l.b(string2);
                l2.a(string2, 1);
                return false;
            }
            catch (IOException iOException) {
                iOException.printStackTrace();
                String string3 = "Failed to load save. (Failed to read header: " + iOException.getMessage() + ")";
                l.b(string3);
                l2.a(string3, 1);
                return false;
            }
            if (!string.equals("rustedWarfareSave")) {
                void var9_17;
                l.b("Map Load: Header is not correct:" + string.substring(0, Math.min(string.length(), 50)));
                String string4 = "Failed to load save. (Could not find correct header)";
                if (string.equals("rustedWarfareReplay")) {
                    String string5 = "Failed to load save. (This file appears to be a replay file, not a save file)";
                }
                l.b((String)var9_17);
                l2.a((String)var9_17, 1);
                return false;
            }
            k2.f();
            int n2 = k2.f();
            l.b("gameSaver", "Loading save from version: " + n2);
            k2.a(n2);
            if (n2 > 96) {
                l2.a("Cannot load: This save was made with a newer game", 1);
                return false;
            }
            if (n2 >= 5) {
                k2.e();
            }
            if (n2 >= 23) {
                br2.a(bs.B);
                k2.a("saveCompression", true);
                br2.b(bs.B);
            }
            if (n2 >= 54) {
                k2.b("customUnitsBlock");
                if (l2.cb.j() && !bl4) {
                    l.e("Loading mods from replay");
                    try {
                        com.corrodinggames.rts.game.units.custom.l.a((k)k2);
                        ag.d();
                    }
                    catch (bd bd2) {
                        l.e("Replay load: Missing unit:" + bd2.getMessage() + " d:" + bd2.b);
                        l2.i(bd2.getMessage() + ", this is likely to cause the replay to desync (reverting to default units & mods)");
                        ag.b((boolean)true);
                    }
                }
                k2.d("customUnitsBlock");
            }
            Integer n3 = null;
            Integer n4 = null;
            if (l2.cb.j() && bl4) {
                n3 = l2.bB;
                n4 = l2.bC;
            }
            if (n2 >= 56) {
                boolean bl6;
                boolean bl7;
                k2.b("gameSetup");
                bl5 = bl7 = k2.e();
                boolean bl8 = false;
                if (n2 >= 94) {
                    bl8 = k2.e();
                    bl5 = k2.e();
                }
                boolean bl9 = bl6 = l2.cb.j() || !l2.bX.B;
                if (bl6 && !bl4 && bl5) {
                    l.e("Using game rules from save");
                    l2.cb.O = true;
                    l2.bX.a(k2);
                    n3 = l2.bB;
                    n4 = l2.bC;
                    if (!(!bl7 && !bl8 || l2.bX.F || l2.bX.B || l2.cb.j())) {
                        l.e("Enabling use of singlePlayer rules from saved game.");
                        l2.bX.F = true;
                    }
                }
                k2.d("gameSetup");
            }
            l2.dm = null;
            String string6 = k2.l();
            string6 = com.corrodinggames.rts.gameFramework.e.a.o(string6);
            l2.dl = this.a(string6);
            bl5 = false;
            if (n2 >= 72 && (bl5 = k2.e())) {
                l.e("Reading remote map stream");
                l2.dm = k2.u();
            }
            if (l2.bX.B && !l2.bX.C && bl4 && l2.bX.aB != null && !bl5) {
                l2.dl = "";
                l2.dm = l2.bX.aB;
            }
            br2.a(bs.z);
            if (bl4) {
                l2.a(true, true, s.c);
                if (l.at()) {
                    l2.dv = true;
                }
            } else {
                l2.a(true, s.c);
            }
            if (!l2.bL.W) {
                l.e("Not loading save because map failed to load");
                return false;
            }
            if (n3 != null) {
                l2.bB = n3;
            }
            if (n4 != null) {
                n4 = l2.bC;
            }
            l l3 = l2;
            synchronized (l3) {
                int n5;
                void var27_79;
                w w2;
                com.corrodinggames.rts.game.units.custom.l l4;
                n n6;
                int n7;
                int n8;
                int n9;
                boolean bl10;
                br2.b(bs.z);
                l2.by = k2.f();
                float f2 = k2.g();
                float f3 = k2.g();
                float f4 = k2.g();
                if (!bl4) {
                    l2.b(f2, f3);
                    l2.cV = f4;
                }
                if (n2 >= 18) {
                    l2.bV.a = k2.f();
                }
                k2.f();
                if (n2 >= 19) {
                    k2.a("end of setup");
                }
                l2.bL.a(k2);
                if (n2 >= 86) {
                    bl10 = k2.e();
                    boolean bl11 = k2.e();
                    n9 = k2.e();
                    n8 = k2.e();
                    if (!bl2 && !bl10) {
                        l2.bL.E = bl11;
                        l2.bL.F = n9;
                        l2.bL.G = n8;
                    }
                }
                if (bl10 = k2.e()) {
                    if (l2.ce == null) {
                        l.b("gameSaver", "making new mission engine on load, this shouldn't happen");
                        l2.ce = new f();
                        l2.ce.a(false);
                    }
                    l2.ce.a(k2);
                }
                if (n2 >= 19) {
                    k2.a("start of teams");
                }
                l.b("gameSaver", "loading teams");
                n[] nArray = new n[n.e];
                n9 = -1;
                if (n2 >= 36) {
                    n9 = k2.f();
                }
                n8 = 8;
                if (n2 >= 49) {
                    n8 = k2.f();
                    n.b((int)n8, (boolean)false);
                    for (n7 = 0; n7 < n.c; ++n7) {
                        if (n7 < n8 || bl2 || (n6 = n.k((int)n7)) == null) continue;
                        n6.I();
                    }
                }
                for (n7 = 0; n7 < n8; ++n7) {
                    boolean bl12;
                    n n10 = n6 = n.k((int)n7);
                    boolean bl13 = k2.e();
                    boolean bl14 = false;
                    if (n2 >= 7) {
                        bl14 = k2.e();
                    }
                    if (bl12 = k2.e()) {
                        if (bl13) {
                            if (n6 == null || !(n6 instanceof com.corrodinggames.rts.game.a.a)) {
                                if (bl2 && !bl4 && n6 != null) {
                                    l.b("Would replace team:" + n7 + " with AI, writing to dummy AI");
                                    nArray[n7] = n6 = new com.corrodinggames.rts.game.a.a(n7, false);
                                } else {
                                    if (bl4) {
                                        l.b("Adding new AI " + n7 + " on resync");
                                    }
                                    n6 = new com.corrodinggames.rts.game.a.a(n7);
                                }
                            }
                        } else if (bl14) {
                            if (n6 == null || !(n6 instanceof c)) {
                                if (bl2) {
                                    l.b("Replacing team:" + n7 + " with NetworkedPlayer");
                                }
                                n6 = new c(n7);
                            }
                        } else if (n6 == null || !(n6 instanceof e)) {
                            if (bl2) {
                                l.b("Replacing team:" + n7 + " with Player");
                                if (n6 != null) {
                                    n6.c("Existing");
                                }
                            }
                            n6 = new e(n7);
                        }
                        Integer n11 = n6.z;
                        if (n2 >= 2) {
                            n6.b(k2);
                        } else {
                            n6.c(k2);
                        }
                        if (bl4) continue;
                        n6.i();
                        if (bl2) {
                            n6.z = n11;
                            n6.c("networkLoad aiDifficultyOverride=" + n11);
                            l2.bX.a(n6);
                            l2.bX.b(n6);
                        }
                        if (n10 == null || n6 == n10) continue;
                        n10.c("Transfering team stats");
                        n10.o = n6.o;
                        n10.V().a(n6.V());
                        continue;
                    }
                    if (bl2 && !l2.cb.j()) {
                        l.b("GameSaver: Would normally remove team:" + n7 + "");
                        nArray[n7] = n.g;
                        continue;
                    }
                    n n12 = n.k((int)n7);
                    if (n12 == null) continue;
                    n12.I();
                }
                n7 = 0;
                boolean bl15 = false;
                l2.bX.aq();
                if (l2.cb.j()) {
                    l2.bs = n.i;
                } else if (l2.bX.B) {
                    int n13;
                    if (l2.bX.z != null && (n13 = l2.bX.z.k) != -3) {
                        n n14 = n.k((int)n13);
                        if (n14 == null) {
                            throw new RuntimeException("GameSaver: Cannot relink player team: " + n13);
                        }
                        l2.bs = n14;
                    }
                } else if (n9 != -1 && n9 != -3) {
                    l2.bs = n.k((int)n9);
                } else {
                    for (int i2 = 0; i2 < n.c; ++i2) {
                        if (!(n.k((int)i2) instanceof e)) continue;
                        l2.bs = n.k((int)i2);
                    }
                }
                o o2 = w.dK();
                for (w w3 : o2) {
                    w3.a();
                }
                if (l2.aa()) {
                    o2 = w.dK();
                    for (w w4 : o2) {
                        if (w4.eh != 0L) continue;
                        if (!(w4 instanceof am)) throw new RuntimeException("GameLoad preload: Found object in list with id:0");
                        l.e("object: " + ((am)w4).c());
                        throw new RuntimeException("GameLoad preload: Found object in list with id:0");
                    }
                }
                boolean bl16 = false;
                int n15 = k2.f();
                for (int i3 = 0; i3 < n15; ++i3) {
                    void var27_70;
                    Object var27_60 = null;
                    byte by = k2.d();
                    if (by == 1) {
                        ar ar2 = (ar)k2.b(ar.class);
                        if (ar2 == ar.Y) {
                            if (l2.cb.j() || l2.bv) {
                                l.e("Creating DebugEditorBuilder for replay");
                                h h2 = new h(false);
                                l4 = l2.bS.i();
                                if (l4 == null || l4.ej) {
                                    l.e("Relinking editor");
                                    l2.bS.a(h2);
                                }
                            } else {
                                l.e("Creating DebugEditorBuilder for load");
                                h h3 = new h(false);
                                n7 = 1;
                            }
                        } else {
                            am am3 = ar2.a();
                        }
                    } else if (by == 3) {
                        com.corrodinggames.rts.game.units.as as2;
                        String string7 = k2.l();
                        l4 = com.corrodinggames.rts.game.units.custom.l.n((String)string7);
                        if (l4 == null) {
                            String string8 = "Could not find custom unit:" + string7;
                            l.e(string8);
                            if (!bl16) {
                                bl16 = true;
                                ad.g(string8);
                            }
                            if ((l4 = com.corrodinggames.rts.game.units.custom.l.b) == null) {
                                throw new RuntimeException("Could not find custom unit:" + string7 + " and missingPlaceHolder is null");
                            }
                        }
                        if ((as2 = com.corrodinggames.rts.game.units.custom.l.c((com.corrodinggames.rts.game.units.as)l4)) != null) {
                            if (as2 instanceof com.corrodinggames.rts.game.units.custom.l) {
                                l4 = (com.corrodinggames.rts.game.units.custom.l)as2;
                            } else {
                                l.b("replacement not a custom unit:" + as2.i());
                            }
                        }
                        am am4 = l4.a();
                    } else {
                        if (by != 2) throw new IOException("Unhandled basic type on load:" + by);
                        byte by2 = k2.d();
                        if (by2 == 1) {
                            com.corrodinggames.rts.game.l l5 = new com.corrodinggames.rts.game.l();
                        } else if (by2 == 2) {
                            com.corrodinggames.rts.game.f f5 = new com.corrodinggames.rts.game.f(false);
                        } else {
                            if (by2 != 3) throw new IOException("Unhandled gameType on load:" + by2);
                            com.corrodinggames.rts.gameFramework.d.f f6 = new com.corrodinggames.rts.gameFramework.d.f(l2.bR);
                        }
                    }
                    var27_70.eh = k2.i();
                    if (var27_70.eh == 0L) {
                        l.b("GameSaver: Adding object with id==0");
                        if (var27_70 instanceof am) {
                            l.b(((am)var27_70).cC());
                        }
                        bl15 = true;
                    }
                    w.dL();
                }
                if (n2 >= 3) {
                    long l6 = k2.i();
                    if (l6 <= 0L) {
                        l.a("GameLoad: Trying to set next unit id <= 0: " + l6);
                        l6 = 100000L;
                    }
                    l2.bX.a(l6);
                } else {
                    l2.bX.a(100000L);
                }
                if (n2 >= 24) {
                    l2.bV.a(k2);
                }
                if (n2 >= 4) {
                    l2.bS.a(k2, bl4);
                }
                if (n2 >= 57) {
                    l2.bY.a(k2, bl4);
                }
                if (n2 >= 7) {
                    for (int i4 = 0; i4 < n8; ++i4) {
                        void var27_74;
                        n n16;
                        n n17 = n.k((int)i4);
                        if (nArray[i4] != null && (n16 = nArray[i4]) == n.g) {
                            Object var27_73 = null;
                        }
                        if (var27_74 == null) continue;
                        Integer n18 = var27_74.z;
                        var27_74.c(k2);
                        if (bl4) continue;
                        if (bl2) {
                            var27_74.z = n18;
                            var27_74.c("networkLoad2 aiDifficultyOverride=" + n18);
                        }
                        l2.bX.a((n)var27_74);
                        l2.bX.b((n)var27_74);
                    }
                } else if (n2 >= 2) {
                    // empty if block
                }
                if (n2 >= 10) {
                    k2.a("Pre-unit data");
                }
                br2.a(bs.A);
                o o3 = w.dK();
                l.b("gameSaver", "Loading unit data for " + o3.size() + " objects.");
                for (w w5 : o3) {
                    w5.a(k2);
                    if (n2 < 10) continue;
                    k2.a("post unit: " + w5.getClass().toString() + " with id:" + w5.eh);
                }
                l.b("gameSaver", "Loading unit data done.");
                br2.b(bs.A);
                if (n7 != 0) {
                    o o4 = w.dK();
                    for (w w6 : o4) {
                        if (!(w6 instanceof am)) continue;
                        l4 = (am)w6;
                        if (l2.cb.j() || l2.bv || l4.r() != ar.Y) continue;
                        l4.ci();
                    }
                }
                if (n2 >= 23) {
                    k2.d("saveCompression");
                }
                if (n2 >= 19) {
                    k2.a("End of Save");
                    k2.l();
                }
                l.b("gameSaver", "Checking for ID overlaps");
                boolean bl17 = false;
                boolean bl18 = true;
                if (bl18) {
                    void var31_109;
                    w[] wArray = w.er.a();
                    int n19 = w.er.size();
                    boolean bl19 = false;
                    while (var31_109 < n19) {
                        w2 = wArray[var31_109];
                        if (w2.eh == 0L) {
                            l.b("GameSaver: Fixing object with zero id.");
                            w2.eh = l2.bX.y();
                        }
                        for (void var33_113 = var31_109 + true; var33_113 < n19; ++var33_113) {
                            w w7 = wArray[var33_113];
                            if (w2 == w7 || w2.eh != w7.eh) continue;
                            ++var27_79;
                            w7.eh = l2.bX.y();
                        }
                        ++var31_109;
                    }
                }
                l.b("gameSaver", "clearing out dead units.");
                l.e("Unit.fastLiveUnitList before:" + am.bE.size());
                Iterator iterator = am.bE.iterator();
                while (iterator.hasNext()) {
                    am am5 = (am)iterator.next();
                    if (!am5.bV) continue;
                    iterator.remove();
                }
                l.e("Unit.fastLiveUnitList after:" + am.bE.size());
                if (var27_79 > 0) {
                    if (n2 <= 2) {
                        l2.a("Warning: " + (int)var27_79 + " errors were found in this save, this is due to a bug in the old version", 1);
                    } else {
                        l2.a("Warning: " + (int)var27_79 + " errors were found in this save", 1);
                    }
                }
                l.b("gameSaver", "Fixing map cost.");
                l2.bU.a((com.corrodinggames.rts.game.units.y)null);
                l2.bU.b();
                l.b("gameSaver", "Fixing map cost done.");
                n.O();
                for (n5 = 0; n5 < n.c; ++n5) {
                    n n20 = n.k((int)n5);
                    if (n20 == null) continue;
                    n20.d(false);
                }
                n.e();
                l.b("gameSaver", "Rebuilt unit caches");
                n.O();
                n.Y();
                n.i.d(false);
                n.h.d(false);
                for (n5 = 0; n5 < n.c; ++n5) {
                    n n21 = n.k((int)n5);
                    if (n21 == null || !(n21 instanceof com.corrodinggames.rts.game.a.a)) continue;
                    com.corrodinggames.rts.game.a.a a2 = (com.corrodinggames.rts.game.a.a)n21;
                    a2.aq();
                }
                if (arrayList != null) {
                    l2.bS.y();
                    Iterator iterator2 = arrayList.iterator();
                    while (iterator2.hasNext()) {
                        long l7 = (Long)iterator2.next();
                        w2 = w.a(l7, true);
                        if (w2 == null) continue;
                        l2.bS.k((am)w2);
                    }
                }
                if (l2.aa()) {
                    o o5 = w.dK();
                    for (w w8 : o5) {
                        if (w8.eh != 0L) continue;
                        if (!(w8 instanceof am)) throw new RuntimeException("GameLoad postload: Found object in list with id:0");
                        l.e("object: " + ((am)w8).c());
                        throw new RuntimeException("GameLoad postload: Found object in list with id:0");
                    }
                }
                l.e("--- Save file load complete ---");
                l.e("GameObject.fastGameObjectList:" + w.er.size());
                l.e("Unit.fastLiveUnitList:" + am.bE.size());
                if (!bl4) {
                    l2.cb.a(bl4);
                }
                if (!this.b) return true;
                br2.b(bs.y);
                br2.a(true, true);
                return true;
            }
        }
        catch (Exception exception) {
            exception.printStackTrace();
            l.e("Save load error, clearing all units");
            o o6 = w.dK();
            for (w w9 : o6) {
                if (w9.eh == 0L) {
                    w9.eh = l2.bX.y();
                }
                w9.a();
            }
            throw new RuntimeException(exception);
        }
    }

    public boolean b(String string) {
        l.e("Deleting: " + string);
        String string2 = com.corrodinggames.rts.gameFramework.e.a.o(string);
        if (string2.contains("\\") || string2.contains("/")) {
            l.e("Cannot get save with path: " + string);
            return false;
        }
        File file = this.a(string, true);
        boolean bl2 = com.corrodinggames.rts.gameFramework.e.a.b(file);
        File file2 = this.a(string + ".map", true);
        com.corrodinggames.rts.gameFramework.e.a.b(file2);
        if (!bl2) {
            l.e("Failed to delete: " + file.getAbsolutePath());
            l.B().i("Failed to delete: " + file.getAbsolutePath());
        }
        return true;
    }

    public void a(boolean bl2) {
        l l2 = l.B();
        if (!bl2) {
            this.c = -9999;
            this.d = -9999;
        }
    }

    public boolean a() {
        l l2 = l.B();
        if (!l2.bQ.autosaving) {
            return false;
        }
        if (l.ax()) {
            return false;
        }
        if (!l2.bG || l2.bH || l2.cb.j()) {
            return false;
        }
        return !l2.M();
    }

    public void b() {
        int n2 = 300000;
        l l2 = l.B();
        if (!this.a()) {
            return;
        }
        if (this.d == -9999) {
            this.c = l2.by;
            this.d = l2.by;
        }
        if (this.d + n2 < l2.by) {
            this.d = l2.by;
            long l3 = br.a();
            this.c();
            double d2 = br.a(l3);
            l.e("Autosaved (" + br.a(d2) + ")");
        }
    }

    public void c() {
        this.b("autosave", true);
    }
}

