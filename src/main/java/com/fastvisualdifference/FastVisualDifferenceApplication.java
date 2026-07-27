package com.fastvisualdifference;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Serves the built Angular application on port 8080. That is the whole of it.
 *
 * <p>There is deliberately no controller, no configuration class and no image handling
 * here. The difference detection runs in the browser in a Web Worker, and no pixel data
 * ever crosses into Java — putting an upload on the path from clicking Compare to seeing
 * boxes would make the measured interval mostly network transfer, which is the reason the
 * engine lives in the browser in the first place.
 *
 * <p>A {@code WebConfig} forwarding unmatched routes to {@code index.html} would be the
 * usual companion to this class, and it would be dead code: the app is built with
 * {@code --routing=false} and has no client-side routes to deep-link into. Spring Boot
 * already serves {@code static/index.html} at the root without help.
 *
 * <p>Build the frontend first — {@code npm run build} inside {@code frontend/} — then
 * {@code mvn spring-boot:run}. The Maven build copies {@code frontend/dist/fvd/browser}
 * onto the classpath under {@code static/}; it does not invoke npm, so the two build
 * systems stay independent and either can be used on its own.
 */
@SpringBootApplication
public class FastVisualDifferenceApplication {

    public static void main(String[] args) {
        SpringApplication.run(FastVisualDifferenceApplication.class, args);
    }
}
