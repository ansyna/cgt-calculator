package com.cgtcalculator.platform.web;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * When the React build is bundled into the jar (src/main/resources/static), serve index.html
 * for client-side routes so deep links and page reloads work.
 */
@Controller
public class SpaController {

    @GetMapping({"/{path:^(?!api$)[^.]*}", "/{path:^(?!api$)[^.]*}/{sub:[^.]*}", "/{path:^(?!api$)[^.]*}/{sub:[^.]*}/{leaf:[^.]*}"})
    public String forward() {
        return "forward:/index.html";
    }
}
