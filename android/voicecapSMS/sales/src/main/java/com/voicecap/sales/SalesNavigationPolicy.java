package com.voicecap.sales;

import java.net.URI;
import java.net.URISyntaxException;

/** Native bridge access is kept within the approved HTTPS origins. */
final class SalesNavigationPolicy {
    enum Decision { IN_APP, EXTERNAL, BLOCKED }

    private SalesNavigationPolicy() { }

    static Decision decide(String destination, String configuredBase, boolean mainFrame) {
        URI target = parse(destination);
        if (!isWebUrl(target)) return Decision.BLOCKED;
        if (isTrustedOrigin(target, parse(configuredBase))) return Decision.IN_APP;
        return mainFrame ? Decision.EXTERNAL : Decision.BLOCKED;
    }

    private static boolean isTrustedOrigin(URI target, URI configured) {
        if (!"https".equalsIgnoreCase(target.getScheme())) return false;
        String host = target.getHost();
        // The production apex redirects to www; both must retain the native bridge.
        if (("voicecap.shop".equalsIgnoreCase(host) || "www.voicecap.shop".equalsIgnoreCase(host))
                && effectivePort(target) == 443) return true;
        return isWebUrl(configured)
                && "https".equalsIgnoreCase(configured.getScheme())
                && host.equalsIgnoreCase(configured.getHost())
                && effectivePort(target) == effectivePort(configured);
    }

    private static boolean isWebUrl(URI uri) {
        if (uri == null || uri.getHost() == null || uri.getRawUserInfo() != null) return false;
        String scheme = uri.getScheme();
        int port = uri.getPort();
        return ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))
                && (port == -1 || (port > 0 && port <= 65535));
    }

    private static int effectivePort(URI uri) {
        if (uri.getPort() != -1) return uri.getPort();
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }

    private static URI parse(String value) {
        if (value == null) return null;
        try {
            return new URI(value);
        } catch (URISyntaxException ignored) {
            return null;
        }
    }
}
