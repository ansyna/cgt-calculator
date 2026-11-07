package com.cgtcalculator.platform.settings;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import com.cgtcalculator.platform.user.User;
import com.cgtcalculator.platform.user.UserRepository;
import com.cgtcalculator.platform.user.UserService;

/** A user's settings on their account: any JSON by key, each user's own, going with the user. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SettingsApiTest {

    @Autowired
    private MockMvc mvc;
    @Autowired
    private UserRepository users;
    @Autowired
    private UserService userService;
    @Autowired
    private JdbcTemplate jdbc;

    private User anna;
    private User ben;

    @BeforeEach
    void users() {
        String unique = Long.toString(System.nanoTime());
        anna = users.save(new User("Anna", "anna" + unique + "@example.com", "x"));
        ben = users.save(new User("Ben", "ben" + unique + "@example.com", "x"));
    }

    private static RequestPostProcessor as(User user) {
        return jwt().jwt(token -> token.subject(user.getId().toString())).authorities(new SimpleGrantedAuthority("ROLE_investor"));
    }

    private org.springframework.test.web.servlet.ResultActions set(User user, String key, String valueJson) throws Exception {
        return mvc.perform(put("/api/settings/" + key).contentType(MediaType.APPLICATION_JSON).with(as(user)).content("{\"value\":" + valueJson + "}"));
    }

    @Test
    void keepsAnyJsonByKey() throws Exception {
        mvc.perform(get("/api/settings").with(as(anna))).andExpect(status().isOk()).andExpect(jsonPath("$").isEmpty());
        set(anna, "pay.inputs", "{\"salary\":60000,\"extras\":[{\"name\":\"Bonus\",\"amount\":5000}]}").andExpect(status().isOk());
        set(anna, "theme", "\"dark\"").andExpect(status().isOk());
        set(anna, "cgt.tickers", "[\"GLOBX\",\"AAPL\"]").andExpect(status().isOk());
        // changed in place
        set(anna, "theme", "\"light\"").andExpect(status().isOk());
        mvc.perform(get("/api/settings").with(as(anna))).andExpect(jsonPath("$['pay.inputs'].salary").value(60000))
                .andExpect(jsonPath("$['pay.inputs'].extras[0].name").value("Bonus")).andExpect(jsonPath("$.theme").value("light"))
                .andExpect(jsonPath("$['cgt.tickers'][1]").value("AAPL"));
        mvc.perform(get("/api/settings").with(as(ben))).andExpect(jsonPath("$").isEmpty());
        // taken out: by a null value, or deleted
        set(anna, "theme", "null").andExpect(status().isOk());
        mvc.perform(delete("/api/settings/cgt.tickers").with(as(anna))).andExpect(status().isNoContent());
        mvc.perform(get("/api/settings").with(as(anna))).andExpect(jsonPath("$.theme").doesNotExist())
                .andExpect(jsonPath("$['cgt.tickers']").doesNotExist()).andExpect(jsonPath("$['pay.inputs']").exists());
    }

    @Test
    void aSettingIsChecked() throws Exception {
        set(anna, "Not A Key", "1").andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.errors.key[0]").value("A setting's key is lower-case letters, digits, dots and dashes."));
        set(anna, "big", "\"" + "x".repeat(SettingsController.MAX_VALUE) + "\"").andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.errors.value[0]").value("That setting is too big to keep."));
    }

    @Test
    void aUsersSettingsGoWithTheUser() throws Exception {
        set(anna, "theme", "\"dark\"").andExpect(status().isOk());
        userService.delete(anna.getId(), false, "test");
        assertThat(jdbc.queryForObject("select count(*) from user_settings where user_id = ?", Integer.class, anna.getId())).isZero();
    }
}
