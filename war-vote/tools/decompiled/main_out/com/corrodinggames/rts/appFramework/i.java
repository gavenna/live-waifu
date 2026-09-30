/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  android.view.ContextMenu
 *  android.view.ContextMenu$ContextMenuInfo
 *  android.view.MenuItem
 *  android.view.View
 *  android.widget.AdapterView$AdapterContextMenuInfo
 */
package com.corrodinggames.rts.appFramework;

import android.app.Activity;
import android.view.ContextMenu;
import android.view.MenuItem;
import android.view.View;
import android.widget.AdapterView;
import com.corrodinggames.rts.appFramework.b;
import com.corrodinggames.rts.appFramework.c;
import com.corrodinggames.rts.game.a.a;
import com.corrodinggames.rts.game.e;
import com.corrodinggames.rts.game.n;
import com.corrodinggames.rts.gameFramework.l;
import com.corrodinggames.rts.gameFramework.s;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class i
extends b {
    boolean c;
    String d;

    @Override
    public void b() {
        super.b();
        com.corrodinggames.rts.appFramework.c.a((Activity)this, true);
    }

    public static String d(String string2) {
        if (string2 == null) {
            return null;
        }
        if (string2.contains("/MOD|")) {
            int n2 = string2.indexOf("/MOD|");
            return string2.substring(n2);
        }
        if (string2.contains("/NEW_PATH|")) {
            int n3 = string2.indexOf("/NEW_PATH|");
            return string2.substring(n3);
        }
        String[] stringArray = string2.split("/");
        return stringArray[stringArray.length - 1];
    }

    public static boolean a(String string2, String string3) {
        String string4;
        Pattern pattern = Pattern.compile(".*\\[(.*)\\].*");
        Matcher matcher = pattern.matcher(string2);
        if (matcher.matches() && ((string4 = matcher.group(1)).toLowerCase(Locale.ENGLISH) + "|").contains("demo|")) {
            return true;
        }
        string4 = string3.replace(".tmx", "");
        return com.corrodinggames.rts.gameFramework.e.a.i(string4 = string4 + "_demo");
    }

    public static String e(String string2) {
        return com.corrodinggames.rts.appFramework.c.b(string2);
    }

    public static boolean f(String string2) {
        return string2.contains("skirmish/");
    }

    public static boolean g(String string2) {
        return string2.contains("SD/");
    }

    /*
     * WARNING - Removed try catching itself - possible behaviour change.
     */
    public static void a(String string2, boolean bl2, int n2, int n3, boolean bl3, boolean bl4) {
        l l2 = l.B();
        l2.bS.g();
        if (bl2 || bl4) {
            int n4 = 0;
            l2.L();
            l l3 = l2;
            synchronized (l3) {
                int n5;
                int n6;
                int n7;
                l2.dm = null;
                l2.dl = string2;
                int n8 = n.c - 1;
                int n9 = com.corrodinggames.rts.appFramework.c.a(string2);
                l.e("Max teams on map: " + string2 + " = " + n9);
                if (n9 > 0 && n9 - 1 < n8) {
                    n8 = n9 - 1;
                }
                n.F();
                l2.bs = new e(0);
                l2.bs.v = "Player";
                for (n7 = 0; n7 <= 1; ++n7) {
                    for (n6 = 1; n6 <= n8; ++n6) {
                        n n10;
                        int n11 = n5 = n6 % 2 == 0 || n7 == 1 ? 1 : 0;
                        if (n4 >= n3 || n5 == 0 || (n10 = n.k(n6)) != null) continue;
                        n10 = new a(n6);
                        n10.v = "AI";
                        n10.r = 0;
                        ++n4;
                    }
                }
                l.e("Allies: " + n4 + "/" + n3);
                n7 = 0;
                n6 = n2 - n3;
                for (n5 = 0; n5 <= 1; ++n5) {
                    for (int i2 = 1; i2 <= n8; ++i2) {
                        n n12;
                        boolean bl5;
                        boolean bl6 = bl5 = i2 % 2 == 1 || n5 == 1;
                        if (!bl3) {
                            bl5 = true;
                        }
                        if (n7 >= n6 || !bl5 || (n12 = n.k(i2)) != null) continue;
                        n12 = new a(i2);
                        n12.v = "AI";
                        ++n7;
                        if (!bl3) continue;
                        n12.r = 1;
                    }
                }
                l2.bX.aq();
                if (!bl4) {
                    l2.a(false, s.b);
                }
            }
        }
        l2.L();
        l l4 = l2;
        synchronized (l4) {
            l2.dm = null;
            l2.dl = string2;
        }
        if (!bl4) {
            l2.a(true, s.b);
        }
    }

    @Override
    public void onCreateContextMenu(ContextMenu contextMenu, View view, ContextMenu.ContextMenuInfo contextMenuInfo) {
        String string2;
        super.onCreateContextMenu(contextMenu, view, contextMenuInfo);
        AdapterView.AdapterContextMenuInfo adapterContextMenuInfo = (AdapterView.AdapterContextMenuInfo)contextMenuInfo;
        View view2 = adapterContextMenuInfo.targetView;
        String string3 = (String)view2.getTag();
        l l2 = l.B();
        String string4 = i.e(string3);
        com.corrodinggames.rts.gameFramework.i.b b2 = string3 != null ? l2.bZ.h(string3) : null;
        this.d = string3;
        contextMenu.setHeaderTitle((CharSequence)string4);
        MenuItem menuItem = contextMenu.add(0, view2.getId(), 0, (CharSequence)"Export");
        if (b2 != null) {
            menuItem.setTitle((CharSequence)"Export (Standalone maps only)");
            menuItem.setEnabled(false);
        }
        MenuItem menuItem2 = contextMenu.add(2, view2.getId(), 0, (CharSequence)"Delete");
        if (b2 != null) {
            menuItem2.setTitle((CharSequence)"Delete (Standalone maps only)");
            menuItem2.setEnabled(false);
        }
        if (b2 != null) {
            string2 = contextMenu.add(4, view2.getId(), 0, (CharSequence)("From Mod: " + b2.b()));
            string2.setEnabled(false);
        }
        if (b2 == null && this.c) {
            string2 = com.corrodinggames.rts.gameFramework.e.a.n(string3);
            MenuItem menuItem3 = contextMenu.add(3, view.getId(), 0, (CharSequence)("Storage: " + string2));
            if (menuItem3 != null) {
                menuItem3.setEnabled(false);
            }
        }
    }
}

