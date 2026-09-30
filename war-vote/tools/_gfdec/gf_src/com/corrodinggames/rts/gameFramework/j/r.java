/*
 * Decompiled with CFR 0.152.
 * 
 * Could not load the following classes:
 *  android.net.http.AndroidHttpClient
 *  org.apache.http.client.HttpClient
 *  org.apache.http.impl.client.DefaultHttpClient
 *  org.apache.http.params.HttpConnectionParams
 *  org.apache.http.params.HttpParams
 */
package com.corrodinggames.rts.gameFramework.j;

import android.net.http.AndroidHttpClient;
import com.corrodinggames.rts.gameFramework.l;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import org.apache.http.client.HttpClient;
import org.apache.http.impl.client.DefaultHttpClient;
import org.apache.http.params.HttpConnectionParams;
import org.apache.http.params.HttpParams;

public class r {
    ReentrantLock a = new ReentrantLock();

    public HttpClient a() {
        return this.a(30000, false);
    }

    public HttpClient b() {
        return this.a(30000, true);
    }

    /*
     * WARNING - Removed try catching itself - possible behaviour change.
     */
    public HttpClient a(int n2, boolean bl2) {
        Object object;
        boolean bl3 = false;
        try {
            bl3 = this.a.tryLock(300L, TimeUnit.MILLISECONDS);
        }
        catch (InterruptedException interruptedException) {
            interruptedException.printStackTrace();
        }
        try {
            if (!bl3) {
                l.b("LoadFromMasterServer", "Could not get getNewHttpClient lock! another thread maybe stuck in getNewHttpClient!");
            }
            object = !bl2 ? AndroidHttpClient.a(null) : new DefaultHttpClient();
            HttpParams httpParams = object.getParams();
            HttpConnectionParams.setConnectionTimeout((HttpParams)httpParams, (int)n2);
            HttpConnectionParams.setSoTimeout((HttpParams)httpParams, (int)20000);
        }
        finally {
            if (bl3) {
                this.a.unlock();
            }
        }
        return object;
    }

    public void a(HttpClient httpClient) {
        if (httpClient instanceof AndroidHttpClient) {
            AndroidHttpClient androidHttpClient = (AndroidHttpClient)httpClient;
            androidHttpClient.a();
        }
    }
}

