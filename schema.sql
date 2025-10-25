-- Limpiamos tablas existentes para poder re-ejecutar esto
DROP TABLE IF EXISTS detalle_ventas;
DROP TABLE IF EXISTS ventas;
DROP TABLE IF EXISTS costos_y_precios;
DROP TABLE IF EXISTS productos;
DROP TABLE IF EXISTS categorias;
DROP TABLE IF EXISTS proveedores;

-- Creación de Tablas

CREATE TABLE proveedores (
    id SERIAL PRIMARY KEY,
    nombre_fantasia VARCHAR(100) NOT NULL,
    cuit VARCHAR(20),
    telefono VARCHAR(50)
);

CREATE TABLE categorias (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL
);

CREATE TABLE productos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    descripcion TEXT,
    sku VARCHAR(100),
    stock_actual NUMERIC(10, 2) DEFAULT 0,
    stock_minimo NUMERIC(10, 2) DEFAULT 0,
    id_categoria INTEGER REFERENCES categorias(id),
    unidad_medida VARCHAR(20) NOT NULL CHECK (unidad_medida IN ('unidad', 'metro', 'kg')) -- Solo permite estos valores
);

CREATE TABLE costos_y_precios (
    id SERIAL PRIMARY KEY,
    id_producto INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE, -- Si se borra el producto, se borra el precio
    id_proveedor INTEGER REFERENCES proveedores(id),
    precio_costo NUMERIC(12, 2) NOT NULL,
    margen_ganancia_porcentaje NUMERIC(5, 2) NOT NULL,
    precio_venta_final NUMERIC(12, 2) NOT NULL,
    fecha_actualizacion TIMESTAMP DEFAULT NOW()
);

CREATE TABLE ventas (
    id SERIAL PRIMARY KEY,
    fecha TIMESTAMP DEFAULT NOW(),
    total NUMERIC(12, 2) NOT NULL,
    id_factura_afip VARCHAR(100)
);

CREATE TABLE detalle_ventas (
    id SERIAL PRIMARY KEY,
    id_venta INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
    id_producto INTEGER NOT NULL REFERENCES productos(id),
    cantidad_vendida NUMERIC(10, 2) NOT NULL,
    precio_unitario_momento NUMERIC(12, 2) NOT NULL
);

-- Insertamos datos de ejemplo para probar
INSERT INTO categorias (nombre) VALUES ('Tornillos'), ('Herramientas Manuales');
INSERT INTO proveedores (nombre_fantasia) VALUES ('Distribuidora Central');
