/*
 * Decompiled with CFR 0.152.
 */
package com.corrodinggames.rts.gameFramework.j;

import com.corrodinggames.rts.gameFramework.j.n;
import java.util.TimerTask;

class o
extends TimerTask {
    int a;

    o(int n2) {
        this.a = n2;
    }

    @Override
    public void run() {
        n.a(this.a, -1);
    }
}

