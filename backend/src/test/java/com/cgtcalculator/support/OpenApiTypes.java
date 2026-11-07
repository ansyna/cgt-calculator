package com.cgtcalculator.support;

import java.lang.reflect.AnnotatedParameterizedType;
import java.lang.reflect.AnnotatedType;
import java.lang.reflect.RecordComponent;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.jspecify.annotations.Nullable;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.media.ArraySchema;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.ObjectSchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.responses.ApiResponse;

/**
 * What springdoc can't see in the Java types, so that the TypeScript generated from the document is exact:
 * <ul>
 * <li>a record's fields are always present (required), except in records written with {@code @JsonInclude(NON_NULL)};</li>
 * <li>fields and list / map entries marked {@link Nullable} can be null.</li>
 * </ul>
 */
public final class OpenApiTypes implements OpenApiCustomizer {

    private static final String REF = "#/components/schemas/";

    private final Map<String, Class<?>> records = scanRecords("com.cgtcalculator");

    @Override
    public void customise(OpenAPI openApi) {
        Map<String, Schema> schemas = openApi.getComponents().getSchemas();

        // every failure has the same body: a message, and the messages per field of a refused form
        schemas.put("ErrorBody", new ObjectSchema()
                .description("The body of every error response (4xx, 5xx).")
                .addProperty("message", type("string"))
                .addProperty("errors", new ObjectSchema().additionalProperties(new ArraySchema().items(type("string")))
                        .description("Messages per field of a form that was refused (422)."))
                .required(List.of("message")));
        openApi.getPaths().values().forEach(path -> path.readOperations().forEach(operation -> {
            if (operation.getResponses().getDefault() == null) {
                operation.getResponses().setDefault(new ApiResponse().description("Error")
                        .content(new Content().addMediaType("application/json", new MediaType().schema(ref("ErrorBody")))));
            }
        }));

        schemas.forEach((name, schema) -> {
            Class<?> record = recordFor(name);
            if (schema.getProperties() == null) {
                return;
            }
            Map<String, Schema> properties = schema.getProperties();
            properties.replaceAll((property, value) -> cells(value));
            if (record == null || name.equals("RatedValue")) {
                return;
            }
            JsonInclude include = record.getAnnotation(JsonInclude.class);
            boolean allPresent = include == null || include.value() != JsonInclude.Include.NON_NULL;
            List<String> required = new ArrayList<>();
            for (RecordComponent component : record.getRecordComponents()) {
                // @JsonProperty on a record component reaches the accessor, where Jackson reads it
                JsonProperty renamed = component.getAccessor().getAnnotation(JsonProperty.class);
                String property = renamed != null ? renamed.value() : component.getName();
                Schema<?> value = properties.get(property);
                if (value == null) {
                    continue;
                }
                required.add(property);
                AnnotatedType type = component.getAnnotatedType();
                if (type.isAnnotationPresent(Nullable.class)) {
                    properties.put(property, nullable(value));
                }
                if (type instanceof AnnotatedParameterizedType parameterized) {
                    AnnotatedType[] arguments = parameterized.getAnnotatedActualTypeArguments();
                    AnnotatedType entry = arguments[arguments.length - 1];
                    if (entry.isAnnotationPresent(Nullable.class)) {
                        if (value.getItems() != null) {
                            value.setItems(nullable(value.getItems()));
                        } else if (value.getAdditionalProperties() instanceof Schema<?> entries) {
                            value.setAdditionalProperties(nullable(entries));
                        }
                    }
                }
            }
            if (allPresent) {
                schema.setRequired(required);
            }
        });
    }

    /** Untyped values ({@code Object} in Java) are scalars; lists of cells are lists of {@code Cell}. */
    private static Schema cells(Schema<?> schema) {
        if (isUntyped(schema)) {
            return ref("Scalar");
        }
        if (schema instanceof ArraySchema || schema.getItems() != null) {
            Schema<?> items = schema.getItems();
            if (items != null && (isCellUnion(items) || isUntyped(items))) {
                schema.setItems(isCellUnion(items) ? ref("Cell") : ref("Scalar"));
            }
        }
        return schema;
    }

    private static boolean isUntyped(Schema<?> schema) {
        return schema.get$ref() == null && schema.getType() == null && (schema.getTypes() == null || schema.getTypes().isEmpty())
                && schema.getProperties() == null && schema.getItems() == null && schema.getAnyOf() == null
                && schema.getOneOf() == null && schema.getAllOf() == null;
    }

    private static boolean isCellUnion(Schema<?> schema) {
        List<Schema> options = schema.getOneOf() != null ? schema.getOneOf() : schema.getAnyOf();
        return options != null && options.stream().anyMatch(o -> (REF + "Plain").equals(o.get$ref()));
    }

    private static Schema nullable(Schema<?> schema) {
        if (schema.get$ref() != null) {
            return new Schema<>().anyOf(List.of(ref(schema.get$ref().substring(REF.length())), type("null")));
        }
        Set<String> types = new LinkedHashSet<>();
        if (schema.getTypes() != null) {
            types.addAll(schema.getTypes());
        } else if (schema.getType() != null) {
            types.add(schema.getType());
        }
        types.add("null");
        schema.setTypes(types);
        return schema;
    }

    private static Schema type(String type) {
        return new Schema<>().types(new LinkedHashSet<>(List.of(type)));
    }

    private static Schema ref(String name) {
        return new Schema<>().$ref(REF + name);
    }

    /** The record behind a schema name; springdoc names a generic record after its type argument too (PageDtoUserDto). */
    private Class<?> recordFor(String schemaName) {
        Class<?> exact = records.get(schemaName);
        if (exact != null) {
            return exact;
        }
        return records.entrySet().stream().filter(e -> schemaName.startsWith(e.getKey()))
                .max((a, b) -> Integer.compare(a.getKey().length(), b.getKey().length()))
                .map(Map.Entry::getValue).orElse(null);
    }

    private static Map<String, Class<?>> scanRecords(String basePackage) {
        ClassPathScanningCandidateComponentProvider scanner = new ClassPathScanningCandidateComponentProvider(false) {
            @Override
            protected boolean isCandidateComponent(org.springframework.beans.factory.annotation.AnnotatedBeanDefinition definition) {
                return true;
            }
        };
        scanner.addIncludeFilter((reader, factory) -> "java.lang.Record".equals(reader.getClassMetadata().getSuperClassName()));
        Map<String, Class<?>> found = new HashMap<>();
        Map<String, List<String>> clashes = new LinkedHashMap<>();
        scanner.findCandidateComponents(basePackage).forEach(definition -> {
            try {
                Class<?> type = Class.forName(definition.getBeanClassName());
                clashes.computeIfAbsent(type.getSimpleName(), k -> new ArrayList<>()).add(type.getName());
                found.put(type.getSimpleName(), type);
            } catch (ClassNotFoundException e) {
                throw new IllegalStateException(e);
            }
        });
        return found;
    }
}
