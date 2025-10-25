// Carga las variables de entorno (la DATABASE_URL)
require('dotenv').config();

// Importamos las librerías
const express = require('express');
const { Pool } = require('pg'); 

// Creamos la aplicación express
const app = express();
const port = 3000;

// Middleware para entender JSON en las peticiones
app.use(express.json());

// --- Configuración de la Base de Datos ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// --- ENDPOINTS (Rutas) ---

// 1. Prueba de Conexión
app.get('/db-test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()'); 
    res.status(200).json({
      message: '¡Conexión a la base de datos exitosa!',
      hora_servidor_db: result.rows[0].now,
    });
  } catch (error) {
    console.error('Error FATAL al conectar a la base de datos. Revisa tu archivo .env:', error);
    res.status(500).json({
      message: 'ERROR DE CONEXIÓN. Revisa la URL en .env.',
      error: error.message,
    });
  }
});

// ==========================================================
// ENDPOINT: PROVEEDORES
// ==========================================================

// POST /proveedores: Crea un nuevo proveedor
app.post('/proveedores', async (req, res) => {
    const { nombre_fantasia, cuit, telefono } = req.body;
    if (!nombre_fantasia) return res.status(400).json({ error: 'El nombre de fantasía es obligatorio.' });

    const query = `
        INSERT INTO proveedores (nombre_fantasia, cuit, telefono)
        VALUES ($1, $2, $3)
        RETURNING id, nombre_fantasia;
    `;
    const values = [nombre_fantasia, cuit, telefono];

    try {
        const result = await pool.query(query, values);
        res.status(201).json({ message: 'Proveedor creado exitosamente.', proveedor: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Error interno del servidor al crear proveedor.' });
    }
});

// GET /proveedores: Lista todos los proveedores
app.get('/proveedores', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, nombre_fantasia, cuit, telefono FROM proveedores ORDER BY nombre_fantasia');
        res.status(200).json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Error interno del servidor al listar proveedores.' });
    }
});

// ==========================================================
// ENDPOINT: CATEGORIAS (Necesario para el módulo de carga)
// ==========================================================

// GET /categorias: Lista todas las categorías
app.get('/categorias', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, nombre FROM categorias ORDER BY nombre');
        res.status(200).json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Error interno del servidor al listar categorías.' });
    }
});

// ==========================================================
// ENDPOINT: PRODUCTOS
// ==========================================================

// POST /productos: Crea un nuevo producto con su costo inicial
app.post('/productos', async (req, res) => {
    const client = await pool.connect(); 
    try {
        await client.query('BEGIN'); 
        const { nombre, sku, stock_actual, stock_minimo, id_categoria, unidad_medida, id_proveedor, precio_costo, margen_ganancia_porcentaje } = req.body;
        
        if (!nombre || !unidad_medida || !id_proveedor || precio_costo === undefined || margen_ganancia_porcentaje === undefined) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Faltan campos obligatorios.' });
        }

        const costo = parseFloat(precio_costo);
        const margen = parseFloat(margen_ganancia_porcentaje);
        const precio_venta_final = costo * (1 + (margen / 100));

        // 1. Insertar Producto
        const queryProducto = `
            INSERT INTO productos (nombre, sku, stock_actual, stock_minimo, id_categoria, unidad_medida)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, nombre;
        `;
        const valuesProducto = [nombre, sku, stock_actual || 0, stock_minimo || 0, id_categoria, unidad_medida];
        const resProducto = await client.query(queryProducto, valuesProducto);
        const nuevoProductoId = resProducto.rows[0].id;
        
        // 2. Insertar Costo y Precio
        const queryCosto = `
            INSERT INTO costos_y_precios (id_producto, id_proveedor, precio_costo, margen_ganancia_porcentaje, precio_venta_final)
            VALUES ($1, $2, $3, $4, $5);
        `;
        const valuesCosto = [nuevoProductoId, id_proveedor, costo, margen, precio_venta_final.toFixed(2)];
        await client.query(queryCosto, valuesCosto);

        await client.query('COMMIT'); 
        res.status(201).json({ message: 'Producto y Costo creados exitosamente.', producto: resProducto.rows[0], precio_venta: precio_venta_final.toFixed(2) });

    } catch (error) {
        await client.query('ROLLBACK'); 
        res.status(500).json({ error: 'Error interno del servidor al crear el producto.', details: error.message });
    } finally {
        client.release();
    }
});

// GET /productos/buscar: Busca productos para el POS y devuelve su precio actual
app.get('/productos/buscar', async (req, res) => {
    const busqueda = req.query.q ? req.query.q.toLowerCase() : '';
    try {
        const query = `
            SELECT 
                p.id, p.nombre, p.sku, p.stock_actual, p.unidad_medida, cp.precio_venta_final
            FROM 
                productos p
            INNER JOIN 
                costos_y_precios cp ON p.id = cp.id_producto
            WHERE 
                LOWER(p.nombre) LIKE $1 OR LOWER(p.sku) LIKE $1
            ORDER BY 
                p.nombre
            LIMIT 50;
        `;
        const values = [`%${busqueda}%`]; 
        const result = await pool.query(query, values);
        res.status(200).json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Error interno del servidor al buscar productos.' });
    }
});

// ==========================================================
// ENDPOINT: PRECIOS (Actualizador Masivo ANTI-INFLACIÓN)
// ==========================================================

// PUT /precios/actualizar-proveedor: Aumenta el costo y recalcula el precio de venta de todos los productos de un proveedor.
app.put('/precios/actualizar-proveedor', async (req, res) => {
    const { id_proveedor, porcentaje_aumento } = req.body;

    if (!id_proveedor || porcentaje_aumento === undefined) return res.status(400).json({ error: 'Debe especificar el id_proveedor y el porcentaje_aumento.' });
    const aumento = parseFloat(porcentaje_aumento);
    if (isNaN(aumento) || aumento === 0) return res.status(400).json({ error: 'El porcentaje de aumento debe ser un número válido y distinto de cero.' });

    try {
        const query = `
            UPDATE costos_y_precios
            SET 
                precio_costo = precio_costo * (1 + $1 / 100),
                precio_venta_final = ROUND(
                    (precio_costo * (1 + $1 / 100)) * (1 + margen_ganancia_porcentaje / 100), 
                    2
                ),
                fecha_actualizacion = NOW()
            WHERE 
                id_proveedor = $2
            RETURNING id_producto;
        `;
        const values = [aumento, id_proveedor];
        const result = await pool.query(query, values);
        
        res.status(200).json({
            message: `¡Precios actualizados exitosamente! Se actualizaron ${result.rowCount} productos para el proveedor ${id_proveedor}.`,
            productos_actualizados: result.rowCount
        });
    } catch (error) {
        res.status(500).json({ error: 'Error interno del servidor al actualizar precios.' });
    }
});

// ==========================================================
// ENDPOINT: VENTAS (POS)
// ==========================================================

// POST /ventas: Registra una nueva venta, descuenta stock y calcula el total.
app.post('/ventas', async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query('BEGIN'); 

        const { items } = req.body; 
        if (!items || items.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'La venta debe contener al menos un ítem.' });
        }

        let totalVenta = 0;
        let erroresStock = [];
        
        // 1. Verificar, calcular el total y descontar el stock
        for (const item of items) {
            const { id_producto, cantidad } = item;
            
            const resProducto = await client.query(`
                SELECT p.nombre, p.stock_actual, cp.precio_venta_final 
                FROM productos p INNER JOIN costos_y_precios cp ON p.id = cp.id_producto
                WHERE p.id = $1
            `, [id_producto]);

            if (resProducto.rows.length === 0) {
                erroresStock.push(`Producto ID ${id_producto} no encontrado.`);
                continue;
            }

            const { nombre, stock_actual, precio_venta_final } = resProducto.rows[0];
            const cantidadNum = parseFloat(cantidad);
            const precioVentaNum = parseFloat(precio_venta_final);

            if (stock_actual < cantidadNum) erroresStock.push(`Stock insuficiente para ${nombre}. Stock actual: ${stock_actual}, solicitado: ${cantidadNum}`);

            totalVenta += precioVentaNum * cantidadNum;
            item.precio_unitario_momento = precioVentaNum; 

            // Actualizar Stock
            await client.query('UPDATE productos SET stock_actual = stock_actual - $1 WHERE id = $2', [cantidadNum, id_producto]);
        }

        if (erroresStock.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Error de stock en la venta. Transacción revertida.', details: erroresStock });
        }
        
        // 2. Crear el registro de Venta
        const resVenta = await client.query('INSERT INTO ventas (total) VALUES ($1) RETURNING id, fecha, total', [totalVenta.toFixed(2)]);
        const id_venta = resVenta.rows[0].id;
        
        // 3. Crear los registros de Detalle de Venta
        for (const item of items) {
            await client.query(`
                INSERT INTO detalle_ventas (id_venta, id_producto, cantidad_vendida, precio_unitario_momento)
                VALUES ($1, $2, $3, $4)
            `, [id_venta, item.id_producto, item.cantidad, item.precio_unitario_momento]);
        }
        
        await client.query('COMMIT'); 
        res.status(201).json({ 
            message: 'Venta registrada exitosamente. Stock actualizado.',
            venta: resVenta.rows[0],
            items_vendidos: items.length
        });

    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Error interno del servidor al registrar la venta.' });
    } finally {
        client.release();
    }
});

// GET /ventas/:id: Obtiene el detalle de una venta específica (necesario para la factura/ticket)
app.get('/ventas/:id', async (req, res) => {
    const id_venta = req.params.id;
    try {
        const queryVenta = 'SELECT id, fecha, total FROM ventas WHERE id = $1';
        const resVenta = await pool.query(queryVenta, [id_venta]);

        if (resVenta.rows.length === 0) return res.status(404).json({ error: 'Venta no encontrada.' });

        const queryDetalle = `
            SELECT 
                dv.cantidad_vendida, dv.precio_unitario_momento, p.nombre, p.sku
            FROM 
                detalle_ventas dv
            JOIN 
                productos p ON dv.id_producto = p.id
            WHERE 
                dv.id_venta = $1
        `;
        const resDetalle = await pool.query(queryDetalle, [id_venta]);

        res.status(200).json({
            venta: resVenta.rows[0],
            detalle: resDetalle.rows
        });
    } catch (error) {
        res.status(500).json({ error: 'Error interno del servidor al obtener el detalle de la venta.' });
    }
});


// --- Iniciar el Servidor ---
app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
  console.log('Presiona CTRL+C para detener.');
});
