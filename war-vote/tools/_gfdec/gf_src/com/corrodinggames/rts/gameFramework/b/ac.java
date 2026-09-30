/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  android.graphics.Bitmap
 *  android.graphics.Bitmap$Config
 */
package com.corrodinggames.rts.gameFramework.b;

import android.graphics.Bitmap;
import com.corrodinggames.rts.gameFramework.b.ad;
import com.corrodinggames.rts.gameFramework.b.ae;
import com.corrodinggames.rts.gameFramework.b.b;
import com.corrodinggames.rts.gameFramework.b.k;
import java.util.ArrayList;
import java.util.HashMap;

public class ac {
    public k a;
    public ad b;
    public static Bitmap c = Bitmap.a((int)64, (int)64, (Bitmap.Config)Bitmap.Config.d);
    HashMap d = new HashMap();
    ArrayList e = new ArrayList();
    int f = 0;
    boolean g;
    boolean h = false;
    int i = 0;
    int j = 0;
    int k = 0;
    int l = 1;

    public ac(k k2, int n2, int n3) {
        this.a = k2;
        this.b = new ad(k2, n2, n3);
    }

    public b a(Bitmap bitmap) {
        ae ae2 = (ae)this.d.get(bitmap);
        if (ae2 != null) {
            if (this.h) {
                this.e.add(bitmap);
            }
            return ae2;
        }
        int n2 = bitmap.b();
        int n3 = bitmap.c();
        int n4 = this.b.b();
        int n5 = this.b.c();
        if (this.i + n2 > n4) {
            this.i = 0;
            this.j += this.k + this.l;
            this.k = 0;
        }
        if (this.j + n3 > n5) {
            if (!this.g) {
                this.g = true;
            }
            return null;
        }
        ae2 = new ae();
        ae2.a = this.b.a;
        ae2.l = this.b;
        int n6 = this.i;
        int n7 = this.j;
        this.i += n2 + this.l;
        if (this.k < n3) {
            this.k = n3;
        }
        this.b.a(this.a, bitmap, n6, n7);
        ae2.o = n6;
        ae2.p = n7;
        ae2.m = (float)n6 / (float)this.b.e;
        ae2.n = (float)n7 / (float)this.b.f;
        ae2.e = this.b.e;
        ae2.f = this.b.f;
        ae2.g = this.b.g;
        ae2.h = this.b.h;
        ae2.c = n2;
        ae2.d = n3;
        ++this.f;
        this.d.put(bitmap, ae2);
        return ae2;
    }

    public void b(Bitmap bitmap) {
        ae ae2 = (ae)this.d.get(bitmap);
        if (ae2 != null) {
            this.d.remove(bitmap);
        }
    }
}

