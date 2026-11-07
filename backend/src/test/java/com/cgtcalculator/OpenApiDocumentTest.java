package com.cgtcalculator;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import com.cgtcalculator.support.OpenApiTypes;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import tools.jackson.databind.ObjectMapper;

/**
 * The API's OpenAPI description, api/openapi.json, generated from the controllers and their response records.
 * The frontend's TypeScript types are generated from it (npm run api:types), so both sides change together.
 * After changing the API, rewrite it with {@code mvn test -Dtest=OpenApiDocumentTest -Dopenapi.update=true}.
 */
@SpringBootTest(properties = {
        "springdoc.api-docs.version=openapi_3_1",
        "springdoc.paths-to-match=/api/**",
        "springdoc.writer-with-order-by-keys=true",
        "springdoc.default-produces-media-type=application/json"})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class OpenApiDocumentTest {

    static final Path DOCUMENT = Path.of("..", "api", "openapi.json");

    @TestConfiguration
    static class Description {
        @Bean
        OpenAPI cgtCalculatorApi() {
            return new OpenAPI()
                    .info(new Info().title("CGT Calculator API").version("1")
                            .description("The API behind the CGT Calculator pages. Log in with POST /api/auth/login and send "
                                    + "the token as \"Authorization: Bearer <token>\"."))
                    .components(new Components().addSecuritySchemes("bearer",
                            new SecurityScheme().type(SecurityScheme.Type.HTTP).scheme("bearer").bearerFormat("JWT")))
                    .addSecurityItem(new SecurityRequirement().addList("bearer"));
        }

        @Bean
        OpenApiTypes openApiTypes() {
            return new OpenApiTypes();
        }
    }

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void theCommittedDescriptionMatchesTheApi() throws Exception {
        String body = mvc.perform(get("/v3/api-docs")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String document = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(objectMapper.readTree(body)) + "\n";
        if (Boolean.getBoolean("openapi.update") || !Files.exists(DOCUMENT)) {
            Files.writeString(DOCUMENT, document);
        }
        assertThat(Files.readString(DOCUMENT))
                .as("api/openapi.json is out of date: run mvn test -Dtest=OpenApiDocumentTest -Dopenapi.update=true, "
                        + "then npm run api:types in frontend/")
                .isEqualTo(document);
    }
}
