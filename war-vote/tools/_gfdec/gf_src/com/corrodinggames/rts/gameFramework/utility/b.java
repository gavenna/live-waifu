/*
 * Decompiled with CFR 0.152.
 */
package com.corrodinggames.rts.gameFramework.utility;

import com.corrodinggames.rts.gameFramework.utility.a$1;
import java.io.Serializable;

class b
implements Serializable {
    private final String a;
    private final StackTraceElement[] b;

    private b(String string, StackTraceElement[] stackTraceElementArray) {
        this.a = string;
        this.b = stackTraceElementArray;
    }

    static /* synthetic */ String a(b b2) {
        return b2.a;
    }

    static /* synthetic */ StackTraceElement[] b(b b2) {
        return b2.b;
    }

    /* synthetic */ b(String string, StackTraceElement[] stackTraceElementArray, a$1 a$1) {
        this(string, stackTraceElementArray);
    }
}

