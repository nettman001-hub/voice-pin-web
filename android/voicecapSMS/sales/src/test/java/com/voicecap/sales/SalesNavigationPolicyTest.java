package com.voicecap.sales;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;

public class SalesNavigationPolicyTest {
    private static final String BASE = "https://www.voicecap.shop";

    @Test
    public void productionCanonicalRedirectStaysInsideApp() {
        assertEquals(SalesNavigationPolicy.Decision.IN_APP,
                SalesNavigationPolicy.decide("https://www.voicecap.shop/sell", "https://voicecap.shop", true));
        assertEquals(SalesNavigationPolicy.Decision.IN_APP,
                SalesNavigationPolicy.decide("https://voicecap.shop/sell", BASE, true));
    }

    @Test
    public void standardHttpsPortAndMixedCaseHostStayInsideApp() {
        assertEquals(SalesNavigationPolicy.Decision.IN_APP,
                SalesNavigationPolicy.decide("https://WWW.VOICECAP.SHOP:443/sell?tab=printer#connect", BASE, true));
    }

    @Test
    public void configuredHttpsOriginUsesExactHostAndPort() {
        String preview = "https://preview.example.test:8443/base";
        assertEquals(SalesNavigationPolicy.Decision.IN_APP,
                SalesNavigationPolicy.decide("https://preview.example.test:8443/sell", preview, true));
        assertEquals(SalesNavigationPolicy.Decision.EXTERNAL,
                SalesNavigationPolicy.decide("https://preview.example.test/sell", preview, true));
        assertEquals(SalesNavigationPolicy.Decision.EXTERNAL,
                SalesNavigationPolicy.decide("https://other.example.test:8443/sell", preview, true));
        assertEquals(SalesNavigationPolicy.Decision.IN_APP,
                SalesNavigationPolicy.decide("https://www.voicecap.shop/sell", preview, true));
    }

    @Test
    public void lookalikeHostsNeverReceiveTheNativeBridge() {
        for (String url : new String[]{
                "https://voicecap.shop.attacker.test/sell",
                "https://www.voicecap.shop.attacker.test/sell",
                "https://notvoicecap.shop/sell",
                "https://wwwvoicecap.shop/sell",
                "https://voicecap.shop./sell"}) {
            assertNotEquals(url, SalesNavigationPolicy.Decision.IN_APP,
                    SalesNavigationPolicy.decide(url, BASE, true));
        }
    }

    @Test
    public void insecureUrlsAndUnexpectedPortsNeverReceiveTheNativeBridge() {
        for (String url : new String[]{
                "http://voicecap.shop/sell",
                "http://www.voicecap.shop/sell",
                "https://www.voicecap.shop:8443/sell",
                "https://voicecap.shop:80/sell"}) {
            assertNotEquals(url, SalesNavigationPolicy.Decision.IN_APP,
                    SalesNavigationPolicy.decide(url, BASE, true));
        }
        assertNotEquals(SalesNavigationPolicy.Decision.IN_APP,
                SalesNavigationPolicy.decide("http://preview.example.test/sell", "http://preview.example.test", true));
    }

    @Test
    public void onlyMainFrameExternalWebLinksOpenTheBrowser() {
        String external = "https://help.example.test/article";
        assertEquals(SalesNavigationPolicy.Decision.EXTERNAL,
                SalesNavigationPolicy.decide(external, BASE, true));
        assertEquals(SalesNavigationPolicy.Decision.BLOCKED,
                SalesNavigationPolicy.decide(external, BASE, false));
        assertEquals(SalesNavigationPolicy.Decision.IN_APP,
                SalesNavigationPolicy.decide("https://www.voicecap.shop/sell", BASE, false));
    }

    @Test
    public void malformedUrlsCredentialsAndNonWebSchemesAreBlocked() {
        for (String url : new String[]{
                null,
                "not a URL",
                "/sell",
                "https://voicecap.shop:0/sell",
                "https://voicecap.shop:70000/sell",
                "https://voicecap.shop@attacker.test/sell",
                "https://user@www.voicecap.shop/sell",
                "javascript:alert(1)",
                "file:///sell.html",
                "content://shop.voicecap.seller/file",
                "intent://www.voicecap.shop/sell#Intent;scheme=https;end"}) {
            assertEquals(String.valueOf(url), SalesNavigationPolicy.Decision.BLOCKED,
                    SalesNavigationPolicy.decide(url, BASE, true));
        }
    }
}
