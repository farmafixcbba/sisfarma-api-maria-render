	require('dotenv').config();
	const express = require('express');
	const mysql = require('mysql2');
	const cors = require('cors');

	const app = express();
	app.use(cors());
	app.use(express.json());

	const fs = require('fs');

	const dbConfig = {
		host: process.env.DB_HOST,
		port: process.env.DB_PORT || 3306,
		user: process.env.DB_USER,
		password: process.env.DB_PASSWORD,
		database: process.env.DB_NAME,
		waitForConnections: true,
		connectionLimit: 10,
		queueLimit: 0,
		connectTimeout: 60000
	};

	// Si DB_SSL es true, habilitar SSL con el certificado de Aiven
	if (process.env.DB_SSL === 'true') {
		try {
			dbConfig.ssl = {
				ca: fs.readFileSync('./ca.pem'),
				rejectUnauthorized: true
			};
		} catch (e) {
			console.log('⚠ No se encontró ca.pem, usando SSL sin certificado');
			dbConfig.ssl = { rejectUnauthorized: false };
		}
	}

	const db = mysql.createPool(dbConfig);

	// Ruta de prueba
	app.get('/', (req, res) => {
		res.json({ mensaje: 'API de SisFarma funcionando 🚀' });
	});

	// ============================================
	// LOGIN
	// ============================================
	app.post('/api/login', (req, res) => {
    const { usuario, password } = req.body;
    if (!usuario || !password) {
        return res.status(400).json({ error: 'Faltan usuario o contraseña' });
    }
    const sql = `
        SELECT u.iduser, u.user_name, u.password, ut.description AS user_type
        FROM users u
        INNER JOIN user_type ut ON u.idtypeuser = ut.idtypeuser
        WHERE u.user_name = ? OR u.login = ?
    `;
    db.query(sql, [usuario, usuario], (err, results) => {
			if (err) {
				console.error('Error en la consulta:', err);
				return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
			}
			if (results.length === 0) {
				return res.status(401).json({ error: 'Usuario no encontrado' });
			}
			const user = results[0];
			if (user.password !== password) {
				return res.status(401).json({ error: 'Contraseña incorrecta' });
			}
			res.json({
				mensaje: 'Login exitoso',
				usuario: {
					id: user.iduser,
					nombre: user.user_name,
					tipo: user.user_type
				}
			});
		});
	});

	// ============================================
	// PRODUCTOS
	// ============================================

	// 1. Lista completa
	app.get('/api/productos', (req, res) => {
		const sql = `
			SELECT 
				p.idproduct,
				p.barcode,
				p.product_name,
				p.active_principle,
				p.cod_digemid,
				l.laboratory,
				c.category,
				COALESCE((SELECT SUM(b.batch_stock) FROM batch b WHERE b.idproduct = p.idproduct), 0) AS stock_total,
				COALESCE((SELECT MAX(b.stock_min) FROM batch b WHERE b.idproduct = p.idproduct AND b.stock_min > 0), 0) AS stock_min,
				(SELECT DATE_FORMAT(MIN(b.expiration_date), '%Y-%m-%d') FROM batch b 
					WHERE b.idproduct = p.idproduct AND b.batch_stock > 0) AS fecha_vencimiento,
				COALESCE((SELECT b.sale_price FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_venta,
				COALESCE((SELECT b.sale_price_b FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_venta_b,
				COALESCE((SELECT b.sale_price_c FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_venta_c,
				COALESCE((SELECT b.purchase_price FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_compra
			FROM product p
			LEFT JOIN laboratory l ON p.idlaboratory = l.idlaboratory
			LEFT JOIN category c ON p.idcategory = c.idcategory
			ORDER BY p.product_name ASC
		`;
		db.query(sql, (err, results) => {
			if (err) return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
			res.json(results);
		});
	});

// ============================================
// CRUD LABORATORIOS
// ============================================

app.post('/api/laboratorios', (req, res) => {
    const { laboratory } = req.body;
    if (!laboratory || laboratory.trim() === '') {
        return res.status(400).json({ error: 'El nombre es obligatorio' });
    }
    db.query('INSERT INTO laboratory (laboratory) VALUES (?)', [laboratory.trim()], (err, result) => {
        if (err) {
            console.error('Error al crear laboratorio:', err);
            return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
        }
        res.json({ mensaje: 'Laboratorio creado', idlaboratory: result.insertId });
    });
});

app.put('/api/laboratorios/:id', (req, res) => {
    const { id } = req.params;
    const { laboratory } = req.body;
    if (!laboratory || laboratory.trim() === '') {
        return res.status(400).json({ error: 'El nombre es obligatorio' });
    }
    db.query('UPDATE laboratory SET laboratory = ? WHERE idlaboratory = ?', [laboratory.trim(), id], (err) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
        res.json({ mensaje: 'Laboratorio actualizado' });
    });
});

app.delete('/api/laboratorios/:id', (req, res) => {
    const { id } = req.params;
    // Verificar si hay productos asociados
    db.query('SELECT COUNT(*) AS total FROM product WHERE idlaboratory = ?', [id], (err, results) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (results[0].total > 0) {
            return res.status(400).json({ error: `No se puede eliminar. Hay ${results[0].total} productos con este laboratorio.` });
        }
        db.query('DELETE FROM laboratory WHERE idlaboratory = ?', [id], (err2) => {
            if (err2) return res.status(500).json({ error: 'Error en el servidor', detalle: err2.message });
            res.json({ mensaje: 'Laboratorio eliminado' });
        });
    });
});

// ============================================
// CRUD CATEGORIAS
// ============================================

app.post('/api/categorias', (req, res) => {
    const { category } = req.body;
    if (!category || category.trim() === '') {
        return res.status(400).json({ error: 'El nombre es obligatorio' });
    }
    db.query('INSERT INTO category (category) VALUES (?)', [category.trim()], (err, result) => {
        if (err) {
            console.error('Error al crear categoría:', err);
            return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
        }
        res.json({ mensaje: 'Categoría creada', idcategory: result.insertId });
    });
});

app.put('/api/categorias/:id', (req, res) => {
    const { id } = req.params;
    const { category } = req.body;
    if (!category || category.trim() === '') {
        return res.status(400).json({ error: 'El nombre es obligatorio' });
    }
    db.query('UPDATE category SET category = ? WHERE idcategory = ?', [category.trim(), id], (err) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
        res.json({ mensaje: 'Categoría actualizada' });
    });
});

app.delete('/api/categorias/:id', (req, res) => {
    const { id } = req.params;
    db.query('SELECT COUNT(*) AS total FROM product WHERE idcategory = ?', [id], (err, results) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (results[0].total > 0) {
            return res.status(400).json({ error: `No se puede eliminar. Hay ${results[0].total} productos con esta categoría.` });
        }
        db.query('DELETE FROM category WHERE idcategory = ?', [id], (err2) => {
            if (err2) return res.status(500).json({ error: 'Error en el servidor', detalle: err2.message });
            res.json({ mensaje: 'Categoría eliminada' });
        });
    });
});

// ============================================
// CRUD UBICACIONES
// ============================================

app.post('/api/locations', (req, res) => {
    const { location } = req.body;
    if (!location || location.trim() === '') {
        return res.status(400).json({ error: 'El nombre es obligatorio' });
    }
    db.query('INSERT INTO location (location, description) VALUES (?, ?)', [location.trim(), ''], (err, result) => {
        if (err) {
            console.error('Error al crear ubicación:', err);
            return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
        }
        res.json({ mensaje: 'Ubicación creada', idlocation: result.insertId });
    });
});

app.put('/api/locations/:id', (req, res) => {
    const { id } = req.params;
    const { location } = req.body;
    if (!location || location.trim() === '') {
        return res.status(400).json({ error: 'El nombre es obligatorio' });
    }
    db.query('UPDATE location SET location = ? WHERE idlocation = ?', [location.trim(), id], (err) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
        res.json({ mensaje: 'Ubicación actualizada' });
    });
});

app.delete('/api/locations/:id', (req, res) => {
    const { id } = req.params;
    db.query('SELECT COUNT(*) AS total FROM product WHERE idlocation = ?', [id], (err, results) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (results[0].total > 0) {
            return res.status(400).json({ error: `No se puede eliminar. Hay ${results[0].total} productos en esta ubicación.` });
        }
        db.query('DELETE FROM location WHERE idlocation = ?', [id], (err2) => {
            if (err2) return res.status(500).json({ error: 'Error en el servidor', detalle: err2.message });
            res.json({ mensaje: 'Ubicación eliminada' });
        });
    });
});

	// 2. Búsqueda por nombre (ANTES de :id)
	app.get('/api/productos/buscar/:texto', (req, res) => {
		const { texto } = req.params;
		const sql = `
			SELECT 
				p.idproduct, p.barcode, p.product_name, p.active_principle, p.cod_digemid,
				l.laboratory, c.category,
				COALESCE((SELECT SUM(b.batch_stock) FROM batch b WHERE b.idproduct = p.idproduct), 0) AS stock_total,
				COALESCE((SELECT MAX(b.stock_min) FROM batch b WHERE b.idproduct = p.idproduct AND b.stock_min > 0), 0) AS stock_min,
				(SELECT DATE_FORMAT(MIN(b.expiration_date), '%Y-%m-%d') FROM batch b 
					WHERE b.idproduct = p.idproduct AND b.batch_stock > 0) AS fecha_vencimiento,
				COALESCE((SELECT b.sale_price FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_venta,
				COALESCE((SELECT b.sale_price_b FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_venta_b,
				COALESCE((SELECT b.sale_price_c FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_venta_c,
				COALESCE((SELECT b.purchase_price FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_compra
			FROM product p
			LEFT JOIN laboratory l ON p.idlaboratory = l.idlaboratory
			LEFT JOIN category c ON p.idcategory = c.idcategory
			WHERE p.product_name LIKE ?
			ORDER BY p.product_name ASC
			LIMIT 50
		`;
		db.query(sql, [`%${texto}%`], (err, results) => {
			if (err) return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
			res.json(results);
		});
	});
	// Filtro por laboratorio
	app.get('/api/productos/laboratorio/:idlab', (req, res) => {
		const { idlab } = req.params;
		const sql = `
			SELECT 
				p.idproduct, p.barcode, p.product_name, p.active_principle, p.cod_digemid,
				l.laboratory, c.category,
				COALESCE((SELECT SUM(b.batch_stock) FROM batch b WHERE b.idproduct = p.idproduct), 0) AS stock_total,
				COALESCE((SELECT MAX(b.stock_min) FROM batch b WHERE b.idproduct = p.idproduct AND b.stock_min > 0), 0) AS stock_min,
				(SELECT DATE_FORMAT(MIN(b.expiration_date), '%Y-%m-%d') FROM batch b 
					WHERE b.idproduct = p.idproduct AND b.batch_stock > 0) AS fecha_vencimiento,
				COALESCE((SELECT b.sale_price FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_venta,
				COALESCE((SELECT b.sale_price_b FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_venta_b,
				COALESCE((SELECT b.sale_price_c FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_venta_c,
				COALESCE((SELECT b.purchase_price FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_compra
			FROM product p
			LEFT JOIN laboratory l ON p.idlaboratory = l.idlaboratory
			LEFT JOIN category c ON p.idcategory = c.idcategory
			WHERE p.idlaboratory = ?
			ORDER BY p.product_name ASC
		`;
		db.query(sql, [idlab], (err, results) => {
			if (err) return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
			res.json(results);
		});
	});

	// Filtro por categoría
	app.get('/api/productos/categoria/:idcat', (req, res) => {
		const { idcat } = req.params;
		const sql = `
			SELECT 
				p.idproduct, p.barcode, p.product_name, p.active_principle, p.cod_digemid,
				l.laboratory, c.category,
				COALESCE((SELECT SUM(b.batch_stock) FROM batch b WHERE b.idproduct = p.idproduct), 0) AS stock_total,
				COALESCE((SELECT MAX(b.stock_min) FROM batch b WHERE b.idproduct = p.idproduct AND b.stock_min > 0), 0) AS stock_min,
				(SELECT DATE_FORMAT(MIN(b.expiration_date), '%Y-%m-%d') FROM batch b 
					WHERE b.idproduct = p.idproduct AND b.batch_stock > 0) AS fecha_vencimiento,
				COALESCE((SELECT b.sale_price FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_venta,
				COALESCE((SELECT b.sale_price_b FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_venta_b,
				COALESCE((SELECT b.sale_price_c FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_venta_c,
				COALESCE((SELECT b.purchase_price FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_compra
			FROM product p
			LEFT JOIN laboratory l ON p.idlaboratory = l.idlaboratory
			LEFT JOIN category c ON p.idcategory = c.idcategory
			WHERE p.idcategory = ?
			ORDER BY p.product_name ASC
		`;
		db.query(sql, [idcat], (err, results) => {
			if (err) return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
			res.json(results);
		});
	});
	// Productos con stock bajo (por debajo del stock mínimo)
	app.get('/api/productos/stock-bajo', (req, res) => {
		const sql = `
			SELECT 
				p.idproduct, p.barcode, p.product_name, l.laboratory, c.category,
				COALESCE((SELECT SUM(b.batch_stock) FROM batch b WHERE b.idproduct = p.idproduct), 0) AS stock_total,
				COALESCE((SELECT MAX(b.stock_min) FROM batch b WHERE b.idproduct = p.idproduct AND b.stock_min > 0), 0) AS stock_min,
				COALESCE((SELECT b.sale_price FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_venta
			FROM product p
			LEFT JOIN laboratory l ON p.idlaboratory = l.idlaboratory
			LEFT JOIN category c ON p.idcategory = c.idcategory
			HAVING stock_min > 0 AND stock_total <= stock_min
			ORDER BY stock_total ASC
		`;
		db.query(sql, (err, results) => {
			if (err) return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
			res.json(results);
		});
	});

	// Productos por vencer (próximos 90 días)
	app.get('/api/productos/por-vencer', (req, res) => {
		const sql = `
			SELECT 
				p.idproduct, p.barcode, p.product_name, l.laboratory, c.category,
				COALESCE((SELECT SUM(b.batch_stock) FROM batch b WHERE b.idproduct = p.idproduct), 0) AS stock_total,
				COALESCE((SELECT MAX(b.stock_min) FROM batch b WHERE b.idproduct = p.idproduct AND b.stock_min > 0), 0) AS stock_min,
				(SELECT DATE_FORMAT(MIN(b.expiration_date), '%Y-%m-%d') FROM batch b 
					WHERE b.idproduct = p.idproduct AND b.batch_stock > 0) AS fecha_vencimiento,
				COALESCE((SELECT b.sale_price FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_venta
			FROM product p
			LEFT JOIN laboratory l ON p.idlaboratory = l.idlaboratory
			LEFT JOIN category c ON p.idcategory = c.idcategory
			HAVING fecha_vencimiento IS NOT NULL 
				AND DATEDIFF(fecha_vencimiento, CURDATE()) <= 90
			ORDER BY fecha_vencimiento ASC
		`;
		db.query(sql, (err, results) => {
			if (err) return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
			res.json(results);
		});
	});

	// Ventas del día (usando zona horaria de Bolivia)
	app.get('/api/ventas/hoy', (req, res) => {
		const sql = `
			SELECT 
				s.idsale,
				s.date_sale,
				s.document,
				s.serie,
				s.voucher_number,
				s.state,
				CONCAT(COALESCE(c.client_name, ''), ' ', COALESCE(c.client_lastname, '')) AS cliente,
				u.user_name AS vendedor,
				ROUND(SUM(ds.amount), 2) AS total
			FROM sale s
			LEFT JOIN client c ON s.idclient = c.idclient
			LEFT JOIN users u ON s.iduser = u.iduser
			LEFT JOIN detail_sale ds ON s.idsale = ds.idsale
			WHERE s.date_sale = DATE(CONVERT_TZ(NOW(), '+00:00', '-04:00'))
			GROUP BY s.idsale
			ORDER BY s.idsale DESC
		`;
		db.query(sql, (err, results) => {
			if (err) return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
			res.json(results);
		});
	});

	// Resumen de ventas del día (zona horaria de Bolivia)
	app.get('/api/ventas/hoy/resumen', (req, res) => {
		const sql = `
			SELECT 
				COUNT(DISTINCT s.idsale) AS cantidad_ventas,
				COALESCE(ROUND(SUM(ds.amount), 2), 0) AS total_dia
			FROM sale s
			LEFT JOIN detail_sale ds ON s.idsale = ds.idsale
			WHERE s.date_sale = DATE(CONVERT_TZ(NOW(), '+00:00', '-04:00'))
		`;
		db.query(sql, (err, results) => {
			if (err) return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
			res.json(results[0]);
		});
	});

	// Filtro combinado (laboratorio + categoría + búsqueda)
	app.get('/api/productos/filtrar', (req, res) => {
		const { idlab, idcat, buscar } = req.query;

		let condiciones = [];
		let params = [];

		if (idlab && idlab !== '0') {
			condiciones.push('p.idlaboratory = ?');
			params.push(idlab);
		}
		if (idcat && idcat !== '0') {
			condiciones.push('p.idcategory = ?');
			params.push(idcat);
		}
		if (buscar && buscar.trim() !== '') {
			condiciones.push('p.product_name LIKE ?');
			params.push(`%${buscar}%`);
		}

		const where = condiciones.length > 0 ? 'WHERE ' + condiciones.join(' AND ') : '';

		const sql = `
			SELECT 
				p.idproduct, p.barcode, p.product_name, p.active_principle, p.cod_digemid,
				l.laboratory, c.category,
				COALESCE((SELECT SUM(b.batch_stock) FROM batch b WHERE b.idproduct = p.idproduct), 0) AS stock_total,
				COALESCE((SELECT MAX(b.stock_min) FROM batch b WHERE b.idproduct = p.idproduct AND b.stock_min > 0), 0) AS stock_min,
				(SELECT DATE_FORMAT(MIN(b.expiration_date), '%Y-%m-%d') FROM batch b 
					WHERE b.idproduct = p.idproduct AND b.batch_stock > 0) AS fecha_vencimiento,
				COALESCE((SELECT b.sale_price FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_venta,
				COALESCE((SELECT b.sale_price_b FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_venta_b,
				COALESCE((SELECT b.sale_price_c FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_venta_c,
				COALESCE((SELECT b.purchase_price FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_compra
			FROM product p
			LEFT JOIN laboratory l ON p.idlaboratory = l.idlaboratory
			LEFT JOIN category c ON p.idcategory = c.idcategory
			${where}
			ORDER BY p.product_name ASC
			LIMIT 200
		`;

		db.query(sql, params, (err, results) => {
			if (err) return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
			res.json(results);
		});
	});

	// Crear nuevo cliente
	app.post('/api/clientes', (req, res) => {
		const { ruc_dni, client_name, client_lastname, address, reference, phone, email } = req.body;

		if (!client_name || client_name.trim() === '') {
			return res.status(400).json({ error: 'El nombre es obligatorio' });
		}

		const sql = `
			INSERT INTO client (ruc_dni, client_name, client_lastname, address, reference, phone, email)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`;

		db.query(sql, [
			ruc_dni || null,
			client_name,
			client_lastname || null,
			address || null,
			reference || null,
			phone || null,
			email || null
		], (err, result) => {
			if (err) {
				console.error('Error al crear cliente:', err);
				// Error de DNI/RUC duplicado
				if (err.code === 'ER_DUP_ENTRY') {
					return res.status(400).json({ error: 'El DNI/RUC ya está registrado' });
				}
				return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
			}
			res.json({
				mensaje: 'Cliente creado con éxito',
				idclient: result.insertId
			});
		});
	});
// ============================================
// CRUD CLIENTES (Editar y Eliminar)
// ============================================

// Actualizar cliente
app.put('/api/clientes/:id', (req, res) => {
    const { id } = req.params;
    const { ruc_dni, client_name, client_lastname, address, reference, phone, email } = req.body;

    if (!client_name || client_name.trim() === '') {
        return res.status(400).json({ error: 'El nombre es obligatorio' });
    }

    const sql = `
        UPDATE client SET
            ruc_dni = ?, client_name = ?, client_lastname = ?,
            address = ?, reference = ?, phone = ?, email = ?
        WHERE idclient = ?
    `;

    db.query(sql, [
        ruc_dni || null,
        client_name.trim(),
        client_lastname || null,
        address || null,
        reference || null,
        phone || null,
        email || null,
        id
    ], (err) => {
        if (err) {
            console.error('Error al actualizar cliente:', err);
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ error: 'El DNI/RUC ya está registrado' });
            }
            return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
        }
        res.json({ mensaje: 'Cliente actualizado' });
    });
});

// Eliminar cliente
app.delete('/api/clientes/:id', (req, res) => {
    const { id } = req.params;

    // No permitir eliminar el PUBLICO GENERAL (idclient = 1)
    if (parseInt(id) === 1) {
        return res.status(400).json({ error: 'No se puede eliminar el cliente Público General' });
    }

    // Verificar si tiene ventas asociadas
    db.query('SELECT COUNT(*) AS total FROM sale WHERE idclient = ?', [id], (err, results) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });

        const tieneVentas = results[0].total > 0;

        if (tieneVentas) {
            // Reasignar ventas a Público General (idclient = 1) y luego eliminar
            db.query('UPDATE sale SET idclient = 1 WHERE idclient = ?', [id], (err2) => {
                if (err2) return res.status(500).json({ error: 'Error al reasignar ventas', detalle: err2.message });

                db.query('DELETE FROM client WHERE idclient = ?', [id], (err3, result) => {
                    if (err3) return res.status(500).json({ error: 'Error al eliminar', detalle: err3.message });
                    if (result.affectedRows === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
                    res.json({
                        mensaje: 'Cliente eliminado',
                        ventas_reasignadas: results[0].total,
                        detalle: `Se reasignaron ${results[0].total} ventas a Público General.`
                    });
                });
            });
        } else {
            // Sin ventas, eliminar directamente
            db.query('DELETE FROM client WHERE idclient = ?', [id], (err2, result) => {
                if (err2) return res.status(500).json({ error: 'Error en el servidor', detalle: err2.message });
                if (result.affectedRows === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
                res.json({ mensaje: 'Cliente eliminado' });
            });
        }
    });
});
	// Crear nuevo producto + primer lote
	app.post('/api/productos', (req, res) => {
		const {
			barcode, product_name, secondary_barcode, active_principle, cod_digemid,
			pathology, realth_register, commission,
			idlaboratory, idcategory, idlocation, idunit,
			// Datos del lote
			batch_number, expiration_date, batch_stock, purchase_price,
			sale_price, sale_price_b, sale_price_c, cant_blister, cant_box, stock_min
		} = req.body;

		// Validaciones
		if (!barcode || !product_name) {
			return res.status(400).json({ error: 'Código de barras y nombre son obligatorios' });
		}
		if (batch_stock === undefined || purchase_price === undefined || sale_price === undefined) {
			return res.status(400).json({ error: 'Los datos del primer lote son obligatorios' });
		}

		// INSERT producto
		const sqlProducto = `
			INSERT INTO product (
				barcode, product_name, secondary_barcode, active_principle, cod_digemid,
				pathology, realth_register, commission,
				idlaboratory, idcategory, idlocation, idunit
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`;

		db.query(sqlProducto, [
			barcode,
			product_name,
			secondary_barcode || null,
			active_principle || null,
			cod_digemid || null,
			pathology || null,
			realth_register || null,
			commission || 0,
			idlaboratory || null,
			idcategory || null,
			idlocation || null,
			idunit || null
		], (err, resultProducto) => {
			if (err) {
				console.error('Error al crear producto:', err);
				if (err.code === 'ER_DUP_ENTRY') {
					return res.status(400).json({ error: 'El código de barras ya existe' });
				}
				return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
			}

			const idProducto = resultProducto.insertId;

			// INSERT lote
			const sqlLote = `
				INSERT INTO batch (
					idproduct, batch_number, expiration_date, batch_stock,
					purchase_price, sale_price, sale_price_b, sale_price_c,
					cant_blister, cant_box, stock_min
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`;

			db.query(sqlLote, [
				idProducto,
				batch_number || null,
				expiration_date || null,
				batch_stock,
				purchase_price,
				sale_price,
				sale_price_b || sale_price,
				sale_price_c || sale_price,
				cant_blister || 0,
				cant_box || 0,
				stock_min || 0
			], (errLote) => {
				if (errLote) {
					console.error('Error al crear lote:', errLote);
					// Si falla el lote, borramos el producto para no dejar basura
					db.query('DELETE FROM product WHERE idproduct = ?', [idProducto]);
					return res.status(500).json({ error: 'Error al crear el lote', detalle: errLote.message });
				}

				res.json({
					mensaje: 'Producto creado con éxito',
					idproduct: idProducto
				});
			});
		});
	});

	// ============================================
	// REPORTES
	// ============================================

	// 1. Ventas por fecha (con resumen)
	app.get('/api/reportes/ventas-fecha', (req, res) => {
		const { desde, hasta } = req.query;
		if (!desde || !hasta) {
			return res.status(400).json({ error: 'Faltan fechas: desde, hasta' });
		}

		const sqlVentas = `
			SELECT 
				s.idsale, s.date_sale, s.document, s.serie, s.voucher_number,
				CONCAT(COALESCE(c.client_name,''), ' ', COALESCE(c.client_lastname,'')) AS cliente,
				u.user_name AS vendedor,
				s.subtotal, s.igv, s.price_total, s.state
			FROM sale s
			LEFT JOIN client c ON s.idclient = c.idclient
			LEFT JOIN users u ON s.iduser = u.iduser
			WHERE s.date_sale BETWEEN ? AND ?
			ORDER BY s.date_sale DESC, s.idsale DESC
		`;

		const sqlResumen = `
			SELECT 
				COUNT(*) AS cantidad_ventas,
				COALESCE(SUM(subtotal), 0) AS total_subtotal,
				COALESCE(SUM(igv), 0) AS total_igv,
				COALESCE(SUM(price_total), 0) AS total_general
			FROM sale
			WHERE date_sale BETWEEN ? AND ? AND state = 'ACEPTADO'
		`;

		db.query(sqlVentas, [desde, hasta], (err, ventas) => {
			if (err) return res.status(500).json({ error: 'Error', detalle: err.message });
			db.query(sqlResumen, [desde, hasta], (err2, resumen) => {
				if (err2) return res.status(500).json({ error: 'Error', detalle: err2.message });
				res.json({ resumen: resumen[0], ventas });
			});
		});
	});

	// 2. Reporte de Caja (ingresos y egresos del día)
	app.get('/api/reportes/caja', (req, res) => {
    const { fecha } = req.query;
    if (!fecha) return res.status(400).json({ error: 'Falta fecha' });

    const sqlVentas = `
        SELECT s.idsale, s.serie, s.voucher_number, s.document, s.price_total, s.state,
               CONCAT(COALESCE(c.client_name,''), ' ', COALESCE(c.client_lastname,'')) AS cliente
        FROM sale s
        LEFT JOIN client c ON s.idclient = c.idclient
        WHERE s.date_sale = ? AND s.state = 'ACEPTADO'
        ORDER BY s.idsale ASC
    `;

    const sqlMovimientos = `
        SELECT id, concept, amount, operation, date
        FROM entry_discharge
        WHERE date = ?
        ORDER BY id ASC
    `;

    db.query(sqlVentas, [fecha], (err, ventas) => {
        if (err) return res.status(500).json({ error: 'Error ventas', detalle: err.message });

        db.query(sqlMovimientos, [fecha], (err2, movimientos) => {
            if (err2) {
                const totalVentas = ventas.reduce((sum, v) => sum + parseFloat(v.price_total || 0), 0);
                return res.json({
                    ventas,
                    movimientos: [],
                    resumen: {
                        total_ventas: totalVentas.toFixed(2),
                        total_ingresos: '0.00',
                        total_egresos: '0.00',
                        saldo_final: totalVentas.toFixed(2)
                    }
                });
            }

            const totalVentas = ventas.reduce((sum, v) => sum + parseFloat(v.price_total || 0), 0);
            const totalIngresos = movimientos
                .filter(m => m.operation === 'INGRESO')
                .reduce((sum, m) => sum + parseFloat(m.amount || 0), 0);
            const totalEgresos = movimientos
                .filter(m => m.operation === 'EGRESO')
                .reduce((sum, m) => sum + parseFloat(m.amount || 0), 0);
            const saldo = totalVentas + totalIngresos - totalEgresos;

            res.json({
                ventas,
                movimientos,
                resumen: {
                    total_ventas: totalVentas.toFixed(2),
                    total_ingresos: totalIngresos.toFixed(2),
                    total_egresos: totalEgresos.toFixed(2),
                    saldo_final: saldo.toFixed(2)
                }
            });
        });
    });
});

	// 3. Ventas por usuario (rango de fechas)
	app.get('/api/reportes/ventas-usuario', (req, res) => {
		const { desde, hasta } = req.query;
		if (!desde || !hasta) return res.status(400).json({ error: 'Faltan fechas' });

		const sql = `
			SELECT 
				u.iduser, u.user_name,
				COUNT(s.idsale) AS cantidad_ventas,
				COALESCE(SUM(s.price_total), 0) AS total_vendido,
				COALESCE(SUM(s.subtotal), 0) AS total_subtotal,
				COALESCE(SUM(s.igv), 0) AS total_igv
			FROM users u
			LEFT JOIN sale s ON u.iduser = s.iduser 
				AND s.date_sale BETWEEN ? AND ? 
				AND s.state = 'ACEPTADO'
			GROUP BY u.iduser, u.user_name
			ORDER BY total_vendido DESC
		`;
		db.query(sql, [desde, hasta], (err, results) => {
			if (err) return res.status(500).json({ error: 'Error', detalle: err.message });
			res.json(results);
		});
	});

	// 4. Inventario por laboratorio (con detalle de productos)
	app.get('/api/reportes/inventario-laboratorio', (req, res) => {
		const sqlResumen = `
			SELECT 
				l.idlaboratory, l.laboratory,
				COUNT(DISTINCT p.idproduct) AS cantidad_productos,
				COALESCE(SUM(b.batch_stock), 0) AS stock_total,
				COALESCE(ROUND(SUM(b.batch_stock * b.purchase_price), 2), 0) AS valor_inventario
			FROM laboratory l
			LEFT JOIN product p ON p.idlaboratory = l.idlaboratory
			LEFT JOIN batch b ON b.idproduct = p.idproduct AND b.batch_stock > 0
			GROUP BY l.idlaboratory, l.laboratory
			ORDER BY l.laboratory ASC
		`;
		db.query(sqlResumen, (err, results) => {
			if (err) return res.status(500).json({ error: 'Error', detalle: err.message });
			res.json(results);
		});
	});

	// Detalle de productos de un laboratorio (para ver cuando tocan uno)
	app.get('/api/reportes/inventario-laboratorio/:idlab', (req, res) => {
		const { idlab } = req.params;
		const sql = `
			SELECT 
				p.idproduct, p.barcode, p.product_name,
				COALESCE(SUM(b.batch_stock), 0) AS stock_total,
				COALESCE(ROUND(SUM(b.batch_stock * b.purchase_price), 2), 0) AS valor_inventario,
				COALESCE((SELECT b2.sale_price FROM batch b2 WHERE b2.idproduct = p.idproduct ORDER BY b2.idbatch DESC LIMIT 1), 0) AS precio_venta
			FROM product p
			LEFT JOIN batch b ON b.idproduct = p.idproduct
			WHERE p.idlaboratory = ?
			GROUP BY p.idproduct, p.barcode, p.product_name
			ORDER BY p.product_name ASC
		`;
		db.query(sql, [idlab], (err, results) => {
			if (err) return res.status(500).json({ error: 'Error', detalle: err.message });
			res.json(results);
		});
	});

	// ============================================
	// VENTAS
	// ============================================
	// ============================================
	// REPORTE PDF: VENTAS POR FECHA
	// ============================================
	const PDFDocument = require('pdfkit');

	// ============================================
// REPORTE PDF: VENTAS POR FECHA (con detalle)
// ============================================
app.get('/api/reportes/ventas-fecha/pdf', (req, res) => {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) {
        return res.status(400).json({ error: 'Faltan fechas' });
    }

    const sql = `
        SELECT 
            s.date_sale,
            p.barcode,
            p.product_name,
            b.batch_number,
            ds.price,
            ds.cantp,
            ds.amount,
            ds.price_type,
            ds.utility,
            ds.fecha
        FROM detail_sale ds
        INNER JOIN sale s ON ds.idsale = s.idsale
        INNER JOIN batch b ON ds.idbatch = b.idbatch
        INNER JOIN product p ON b.idproduct = p.idproduct
        WHERE s.date_sale BETWEEN ? AND ? 
            AND s.state = 'ACEPTADO'
            AND ds.state = 'VENDIDO'
        ORDER BY s.date_sale ASC, ds.count ASC
    `;

    db.query(sql, [desde, hasta], (err, items) => {
        if (err) return res.status(500).json({ error: 'Error', detalle: err.message });

        // Calcular totales
        const totalImporte = items.reduce((sum, i) => sum + parseFloat(i.amount || 0), 0);
        const totalUtilidad = items.reduce((sum, i) => sum + parseFloat(i.utility || 0), 0);

        // Crear PDF horizontal (landscape)
        const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="ventas_${desde}_${hasta}.pdf"`);

        doc.pipe(res);

        // Encabezado
        doc.fontSize(16).font('Helvetica-Bold').text('REPORTE DETALLE VENTAS POR FECHA', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(10).font('Helvetica');
        doc.text(`Desde: ${desde}`, 30, doc.y);
        doc.text(`Hasta: ${hasta}`, 0, doc.y, { align: 'right' });
        doc.moveDown(1);

        // Columnas
        const cols = [
            { label: 'FECHA', x: 30, w: 70 },
            { label: 'COD. BARRAS', x: 100, w: 80 },
            { label: 'DESCRIPCION', x: 180, w: 180 },
            { label: 'N° LOTE', x: 360, w: 80 },
            { label: 'PRECIO', x: 440, w: 55 },
            { label: 'CANT', x: 495, w: 45 },
            { label: 'IMPORTE', x: 540, w: 65 },
            { label: 'TIPO PRECIO', x: 605, w: 70 },
            { label: 'UTILIDAD', x: 675, w: 65 },
        ];

        // Encabezado de tabla
        const startY = doc.y;
        doc.fontSize(9).font('Helvetica-Bold');
        cols.forEach(col => {
            doc.text(col.label, col.x, startY, { width: col.w });
        });
        doc.moveDown(0.5);
        doc.moveTo(30, doc.y).lineTo(740, doc.y).stroke();
        doc.moveDown(0.3);

        // Filas
        doc.fontSize(8).font('Helvetica');
        items.forEach(item => {
            if (doc.y > 550) {
                doc.addPage({ size: 'A4', layout: 'landscape', margin: 30 });
                doc.fontSize(8).font('Helvetica');
            }

            const y = doc.y;
            const fecha = (item.date_sale || '').toString().substring(0, 10);
            const barcode = item.barcode || '-';
            const desc = (item.product_name || '').substring(0, 40);
            const lote = (item.batch_number || '-').substring(0, 15);
            const precio = parseFloat(item.price || 0).toFixed(2);
            const cant = parseFloat(item.cantp || 0).toFixed(0);
            const importe = parseFloat(item.amount || 0).toFixed(2);
            const tipo = (item.price_type || 'UNIDAD').toUpperCase();
            const utilidad = parseFloat(item.utility || 0).toFixed(2);

            doc.text(fecha, cols[0].x, y, { width: cols[0].w });
            doc.text(barcode, cols[1].x, y, { width: cols[1].w });
            doc.text(desc, cols[2].x, y, { width: cols[2].w });
            doc.text(lote, cols[3].x, y, { width: cols[3].w });
            doc.text(precio, cols[4].x, y, { width: cols[4].w });
            doc.text(cant, cols[5].x, y, { width: cols[5].w });
            doc.text(importe, cols[6].x, y, { width: cols[6].w });
            doc.text(tipo, cols[7].x, y, { width: cols[7].w });
            doc.text(utilidad, cols[8].x, y, { width: cols[8].w });
            doc.moveDown(0.4);
        });

        // Totales
        doc.moveDown(1);
        doc.moveTo(30, doc.y).lineTo(740, doc.y).stroke();
        doc.moveDown(0.5);
        doc.fontSize(10).font('Helvetica-Bold');
        doc.text(`Total importe:  Bs. ${totalImporte.toFixed(2)}`, 400, doc.y, { width: 150, align: 'left' });
        doc.text(`Total utilidad:  Bs. ${totalUtilidad.toFixed(2)}`, 570, doc.y - 12, { width: 150, align: 'left' });
        doc.moveDown(1);

        doc.fontSize(9).font('Helvetica');
        doc.text(`Total registros: ${items.length}`, 400, doc.y, { width: 200, align: 'right' });

        // Pie
        doc.moveDown(1);
        const fechaBolivia = new Date().toLocaleString('es-BO', { timeZone: 'America/La_Paz' });
        doc.fontSize(8).font('Helvetica').text(`Generado el ${fechaBolivia}`, { align: 'center' });
        doc.text('SisFarma - Sistema de Farmacia', { align: 'center' });

        doc.end();
    });
});

	// Obtener lotes disponibles de un producto
app.get('/api/productos/:id/lotes', (req, res) => {
    const { id } = req.params;
    const sql = `
        SELECT 
            b.idbatch, b.batch_number, b.expiration_date, b.batch_stock,
            b.purchase_price, b.sale_price, b.sale_price_b, b.sale_price_c,
            b.cant_blister, b.cant_box,
            b.sale_price_blister, b.sale_price_box
        FROM batch b
        WHERE b.idproduct = ? AND b.batch_stock > 0
        ORDER BY b.expiration_date ASC
    `;
    db.query(sql, [id], (err, results) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
        res.json(results);
    });
});

	// Registrar venta completa (con transacción)
	app.post('/api/ventas', (req, res) => {
		const { idclient, iduser, tipo_comprobante, items, pay_with, aplicar_iva, descuento } = req.body;

		if (!iduser) return res.status(400).json({ error: 'Falta iduser' });
		if (!items || items.length === 0) return res.status(400).json({ error: 'No hay items' });

		// Mapear tipo a id
		const tipo = tipo_comprobante || 'BOLETA';
		const tipoId = tipo === 'FACTURA' ? 3 : (tipo === 'NOTA DE VENTA' ? 1 : 2);

		db.getConnection((err, conn) => {
			if (err) return res.status(500).json({ error: 'Error de conexión' });

			conn.beginTransaction((err) => {
				if (err) { conn.release(); return res.status(500).json({ error: 'Error al iniciar transacción' }); }

				// 1. Leer y bloquear correlativo
				conn.query(
					'SELECT serie, num FROM config_number_voucher WHERE idconfig_voucher = ? FOR UPDATE',
					[tipoId],
					(err, results) => {
						if (err || results.length === 0) {
							return conn.rollback(() => {
								conn.release();
								res.status(500).json({ error: 'Error al leer correlativo' });
							});
						}

						const serie = results[0].serie;
						const numeroActual = parseInt(results[0].num, 10);
						const nuevoNumero = numeroActual + 1;
						const numeroStr = String(nuevoNumero).padStart(8, '0');

						// 2. Actualizar correlativo
						conn.query(
							'UPDATE config_number_voucher SET num = ? WHERE idconfig_voucher = ?',
							[numeroStr, tipoId],
							(err) => {
								if (err) {
									return conn.rollback(() => {
										conn.release();
										res.status(500).json({ error: 'Error al actualizar correlativo' });
									});
								}

								// 3. Calcular totales
								let totalBruto = 0;
								items.forEach(it => { totalBruto += it.price * it.cantidad; });
								const desc = descuento || 0;
								const totalConDesc = totalBruto - desc;

								let subtotal, igv, priceTotal;
								if (aplicar_iva) {
									// IVA 13% incluido en el precio
									priceTotal = totalConDesc;
									subtotal = priceTotal / 1.13;
									igv = priceTotal - subtotal;
								} else {
									subtotal = totalConDesc;
									igv = 0;
									priceTotal = totalConDesc;
								}

								const chang = pay_with ? (pay_with - priceTotal) : 0;

								// 4. Insertar cabecera
								const sqlSale = `
									INSERT INTO sale (
										iduser, idclient, document, serie, voucher_number,
										total_sale, discount, subtotal, igv, price_total,
										pay_with, chang, date_sale, payment_condition,
										idcoin, total_text, state
									) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE(CONVERT_TZ(NOW(), '+00:00', '-04:00')), 'CONTADO', 1, ?, 'ACEPTADO')
								`;

								conn.query(sqlSale, [
									iduser, idclient || null, tipo, serie, numeroStr,
									totalBruto, desc,
									subtotal.toFixed(2), igv.toFixed(2), priceTotal.toFixed(2),
									pay_with || priceTotal, chang.toFixed(2),
									''
								], (err, resultSale) => {
									if (err) {
										console.error('Error sale:', err);
										return conn.rollback(() => {
											conn.release();
											res.status(500).json({ error: 'Error al insertar venta', detalle: err.message });
										});
									}

									const idsale = resultSale.insertId;
									let i = 0;

									// 5. Insertar detalles recursivamente
									const siguiente = () => {
										if (i >= items.length) {
											// 6. Commit
											conn.commit((err) => {
												if (err) {
													return conn.rollback(() => {
														conn.release();
														res.status(500).json({ error: 'Error al confirmar' });
													});
												}
												conn.release();
												res.json({
													mensaje: 'Venta registrada',
													idsale,
													comprobante: serie + numeroStr,
													subtotal: subtotal.toFixed(2),
													igv: igv.toFixed(2),
													total: priceTotal.toFixed(2),
													chang: chang.toFixed(2)
												});
											});
											return;
										}

										const item = items[i];
										const amount = item.price * item.cantidad;
										const utility = (item.price - (item.purchase_price || 0)) * item.cantidad;

										conn.query(
											`INSERT INTO detail_sale (idsale, idbatch, price, cantp, amount, price_type, state, utility)
											 VALUES (?, ?, ?, ?, ?, ?, 'VENDIDO', ?)`,
											[idsale, item.idbatch, item.price, item.cantidad, amount, item.price_type || 'A', utility],
											(err) => {
												if (err) {
													console.error('Error detail:', err);
													return conn.rollback(() => {
														conn.release();
														res.status(500).json({ error: 'Error al insertar detalle', detalle: err.message });
													});
												}

												conn.query(
													'UPDATE batch SET batch_stock = batch_stock - ? WHERE idbatch = ?',
													[item.cantidad, item.idbatch],
													(err) => {
														if (err) {
															return conn.rollback(() => {
																conn.release();
																res.status(500).json({ error: 'Error al actualizar stock', detalle: err.message });
															});
														}
														i++;
														siguiente();
													}
												);
											}
										);
									};

									siguiente();
								});
							}
						);
					}
				);
			});
		});
	});

// ============================================
// GESTIÓN COMPLETA DE LOTES
// ============================================

// Obtener TODOS los lotes de un producto (incluso sin stock)
app.get('/api/productos/:id/todos-lotes', (req, res) => {
    const { id } = req.params;
    const sql = `
        SELECT 
            b.idbatch, b.batch_number, b.expiration_date, b.batch_stock,
            b.purchase_price, b.sale_price, b.sale_price_b, b.sale_price_c,
            b.cant_blister, b.cant_box, b.stock_min,
            b.sale_price_blister, b.sale_price_box
        FROM batch b
        WHERE b.idproduct = ?
        ORDER BY b.expiration_date ASC, b.idbatch ASC
    `;
    db.query(sql, [id], (err, results) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
        res.json(results);
    });
});

// Eliminar un lote
app.delete('/api/batch/:id', (req, res) => {
    const { id } = req.params;
    db.query('SELECT batch_stock FROM batch WHERE idbatch = ?', [id], (err, results) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor' });
        if (results.length === 0) return res.status(404).json({ error: 'Lote no encontrado' });
        // No dejar eliminar si el lote tiene stock > 0
        if (parseFloat(results[0].batch_stock) > 0) {
            return res.status(400).json({ error: 'No se puede eliminar un lote con stock. Baje el stock a 0 primero.' });
        }
        db.query('DELETE FROM batch WHERE idbatch = ?', [id], (err2) => {
            if (err2) return res.status(500).json({ error: 'Error en el servidor', detalle: err2.message });
            res.json({ mensaje: 'Lote eliminado' });
        });
    });
});

	// 5. Detalle por ID (AL FINAL, porque es genérica)
	app.get('/api/productos/:id', (req, res) => {
		const { id } = req.params;
		const sql = `
			SELECT 
				p.idproduct,
				p.barcode,
				p.secondary_barcode,
				p.product_name,
				p.active_principle,
				p.cod_digemid,
				p.pathology,
				p.realth_register,
				p.commission,
				l.laboratory,
				c.category,
				loc.location,
				u.measure AS unit,
				u.simbol AS unit_symbol,
				COALESCE((SELECT SUM(b.batch_stock) FROM batch b WHERE b.idproduct = p.idproduct), 0) AS stock_total,
				COALESCE((SELECT MAX(b.stock_min) FROM batch b WHERE b.idproduct = p.idproduct AND b.stock_min > 0), 0) AS stock_min,
				(SELECT DATE_FORMAT(MIN(b.expiration_date), '%Y-%m-%d') FROM batch b 
					WHERE b.idproduct = p.idproduct AND b.batch_stock > 0) AS fecha_vencimiento,
				COALESCE((SELECT b.sale_price FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_venta,
				COALESCE((SELECT b.sale_price_b FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_venta_b,
				COALESCE((SELECT b.sale_price_c FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_venta_c,
				COALESCE((SELECT b.purchase_price FROM batch b WHERE b.idproduct = p.idproduct ORDER BY b.idbatch DESC LIMIT 1), 0) AS precio_compra
			FROM product p
			LEFT JOIN laboratory l ON p.idlaboratory = l.idlaboratory
			LEFT JOIN category c ON p.idcategory = c.idcategory
			LEFT JOIN location loc ON p.idlocation = loc.idlocation
			LEFT JOIN unit_of_measure u ON p.idunit = u.idunit
			WHERE p.idproduct = ?
		`;
		db.query(sql, [id], (err, results) => {
			if (err) {
				console.error('Error en producto:', err);
				return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
			}
			if (results.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });
			res.json(results[0]);
		});
	});

	// ============================================
	// OTROS ENDPOINTS
	// ============================================

	app.get('/api/stock/:id', (req, res) => {
		const { id } = req.params;
		const sql = `
			SELECT p.idproduct, p.product_name, COALESCE(SUM(b.batch_stock), 0) AS stock_total
			FROM product p
			LEFT JOIN batch b ON p.idproduct = b.idproduct
			WHERE p.idproduct = ?
			GROUP BY p.idproduct
		`;
		db.query(sql, [id], (err, results) => {
			if (err) return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
			if (results.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });
			res.json(results[0]);
		});
	});

	app.get('/api/clientes', (req, res) => {
		const sql = `SELECT idclient, ruc_dni, client_name, client_lastname, phone, email FROM client ORDER BY client_name ASC`;
		db.query(sql, (err, results) => {
			if (err) return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
			res.json(results);
		});
	});

	app.get('/api/laboratorios', (req, res) => {
		const sql = `SELECT idlaboratory, laboratory FROM laboratory ORDER BY laboratory ASC`;
		db.query(sql, (err, results) => {
			if (err) return res.status(500).json({ error: 'Error en el servidor' });
			res.json(results);
		});
	});

	app.get('/api/categorias', (req, res) => {
		const sql = `SELECT idcategory, category FROM category ORDER BY category ASC`;
		db.query(sql, (err, results) => {
			if (err) return res.status(500).json({ error: 'Error en el servidor' });
			res.json(results);
		});
	});

	app.get('/api/locations', (req, res) => {
		const sql = `SELECT idlocation, location FROM location ORDER BY location ASC`;
		db.query(sql, (err, results) => {
			if (err) return res.status(500).json({ error: 'Error en el servidor' });
			res.json(results);
		});
	});

	app.get('/api/units', (req, res) => {
		const sql = `SELECT idunit, measure, simbol FROM unit_of_measure ORDER BY measure ASC`;
		db.query(sql, (err, results) => {
			if (err) return res.status(500).json({ error: 'Error en el servidor' });
			res.json(results);
		});
	});

	// ============================================
	// EDITAR PRODUCTO
	// ============================================

	// Actualizar datos del producto
	app.put('/api/productos/:id', (req, res) => {
		const { id } = req.params;
		const {
			barcode, product_name, active_principle, cod_digemid,
			realth_register, commission,
			idlaboratory, idcategory, idlocation, idunit
		} = req.body;

		if (!barcode || !product_name) {
			return res.status(400).json({ error: 'Código de barras y nombre son obligatorios' });
		}

		const sql = `
			UPDATE product SET
				barcode = ?, product_name = ?, active_principle = ?, cod_digemid = ?,
				realth_register = ?, commission = ?,
				idlaboratory = ?, idcategory = ?, idlocation = ?, idunit = ?
			WHERE idproduct = ?
		`;

		db.query(sql, [
			barcode, product_name,
			active_principle || null,
			cod_digemid || null,
			realth_register || null,
			commission || 0,
			idlaboratory || null,
			idcategory || null,
			idlocation || null,
			idunit || null,
			id
		], (err) => {
			if (err) {
				console.error('Error al actualizar producto:', err);
				if (err.code === 'ER_DUP_ENTRY') {
					return res.status(400).json({ error: 'El código de barras ya existe' });
				}
				return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
			}
			res.json({ mensaje: 'Producto actualizado' });
		});
	});

	// Actualizar lote
	app.put('/api/batch/:id', (req, res) => {
    const { id } = req.params;
    const {
        batch_number, expiration_date, batch_stock,
        purchase_price, sale_price, sale_price_b, sale_price_c,
        cant_blister, cant_box, stock_min,
        sale_price_blister, sale_price_box
    } = req.body;

    const sql = `
        UPDATE batch SET
            batch_number = ?, expiration_date = ?, batch_stock = ?,
            purchase_price = ?, sale_price = ?, sale_price_b = ?, sale_price_c = ?,
            cant_blister = ?, cant_box = ?, stock_min = ?,
            sale_price_blister = ?, sale_price_box = ?
        WHERE idbatch = ?
    `;

    db.query(sql, [
        batch_number || null,
        expiration_date || null,
        batch_stock || 0,
        purchase_price || 0,
        sale_price || 0,
        sale_price_b || sale_price || 0,
        sale_price_c || sale_price || 0,
        cant_blister || 0,
        cant_box || 0,
        stock_min || 0,
        sale_price_blister || null,
        sale_price_box || null,
        id
    ], (err) => {
        if (err) {
            console.error('Error al actualizar lote:', err);
            return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
        }
        res.json({ mensaje: 'Lote actualizado' });
    });
});

	// Agregar nuevo lote a un producto existente
app.post('/api/productos/:id/lotes', (req, res) => {
    const { id } = req.params;
    const {
        batch_number, expiration_date, batch_stock,
        purchase_price, sale_price, sale_price_b, sale_price_c,
        cant_blister, cant_box, stock_min,
        sale_price_blister, sale_price_box
    } = req.body;

    const sql = `
        INSERT INTO batch (idproduct, batch_number, expiration_date, batch_stock,
            purchase_price, sale_price, sale_price_b, sale_price_c,
            cant_blister, cant_box, stock_min, sale_price_blister, sale_price_box)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, [
        id,
        batch_number || null,
        expiration_date || null,
        batch_stock || 0,
        purchase_price || 0,
        sale_price || 0,
        sale_price_b || sale_price || 0,
        sale_price_c || sale_price || 0,
        cant_blister || 0,
        cant_box || 0,
        stock_min || 0,
        sale_price_blister || null,
        sale_price_box || null
    ], (err, result) => {
        if (err) {
            console.error('Error al agregar lote:', err);
            return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
        }
        res.json({ mensaje: 'Lote agregado', idbatch: result.insertId });
    });
});

// ============================================
// ELIMINAR PRODUCTO (solo si no tiene lotes)
// ============================================
app.delete('/api/productos/:id', (req, res) => {
    const { id } = req.params;

    // Verificar si tiene lotes
    db.query('SELECT COUNT(*) AS total FROM batch WHERE idproduct = ?', [id], (err, results) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
        
        if (results[0].total > 0) {
            return res.status(400).json({ 
                error: `No se puede eliminar. El producto tiene ${results[0].total} lote(s) asociado(s). Elimine los lotes primero.` 
            });
        }

        // Verificar si tiene ventas asociadas (por seguridad)
        db.query(`
            SELECT COUNT(*) AS total 
            FROM detail_sale ds 
            INNER JOIN batch b ON ds.idbatch = b.idbatch 
            WHERE b.idproduct = ?
        `, [id], (err2, results2) => {
            if (err2) return res.status(500).json({ error: 'Error en el servidor' });
            
            if (results2[0].total > 0) {
                return res.status(400).json({ 
                    error: 'No se puede eliminar. El producto tiene ventas registradas en el historial.' 
                });
            }

            // Eliminar el producto
            db.query('DELETE FROM product WHERE idproduct = ?', [id], (err3, result) => {
                if (err3) return res.status(500).json({ error: 'Error en el servidor', detalle: err3.message });
                if (result.affectedRows === 0) return res.status(404).json({ error: 'Producto no encontrado' });
                res.json({ mensaje: 'Producto eliminado' });
            });
        });
    });
});

// ============================================
// CRUD INGRESO / EGRESO
// ============================================

// Listar movimientos (por rango de fechas)
app.get('/api/ingresos-egresos', (req, res) => {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) {
        return res.status(400).json({ error: 'Faltan fechas' });
    }
    const sql = `
        SELECT 
            id, date, number, iduser,
            concept, operation, amount, observation
        FROM entry_discharge
        WHERE date BETWEEN ? AND ?
        ORDER BY date DESC, id DESC
    `;
    db.query(sql, [desde, hasta], (err, results) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
        res.json(results);
    });
});

// Crear movimiento
app.post('/api/ingresos-egresos', (req, res) => {
    const { date, concept, operation, amount, observation, iduser } = req.body;

    if (!concept || concept.trim() === '') {
        return res.status(400).json({ error: 'El concepto es obligatorio' });
    }
    if (!operation || (operation !== 'INGRESO' && operation !== 'EGRESO')) {
        return res.status(400).json({ error: 'La operación debe ser INGRESO o EGRESO' });
    }
    if (amount === undefined || amount <= 0) {
        return res.status(400).json({ error: 'El importe debe ser mayor a 0' });
    }

    // Generar número correlativo
    db.query(
        "SELECT COALESCE(MAX(number), 0) + 1 AS siguiente FROM entry_discharge",
        (err, results) => {
            if (err) return res.status(500).json({ error: 'Error al generar número' });
            const numero = results[0].siguiente;

            const sql = `
                INSERT INTO entry_discharge 
                (date, number, iduser, concept, operation, amount, observation)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `;
            db.query(sql, [
                date || new Date().toISOString().substring(0, 10),
                numero,
                iduser || null,
                concept.trim(),
                operation,
                amount,
                observation || null
            ], (err2, result) => {
                if (err2) {
                    console.error('Error al crear movimiento:', err2);
                    return res.status(500).json({ error: 'Error en el servidor', detalle: err2.message });
                }
                res.json({ mensaje: 'Movimiento registrado', id: result.insertId, number: numero });
            });
        }
    );
});

// Eliminar movimiento
app.delete('/api/ingresos-egresos/:id', (req, res) => {
    const { id } = req.params;
    db.query('DELETE FROM entry_discharge WHERE id = ?', [id], (err, result) => {
        if (err) return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Movimiento no encontrado' });
        res.json({ mensaje: 'Movimiento eliminado' });
    });
});

// Resumen de caja completo
app.get('/api/reportes/caja-completo', (req, res) => {
    const { fecha } = req.query;
    if (!fecha) return res.status(400).json({ error: 'Falta fecha' });

    const sqlVentas = `
        SELECT COALESCE(SUM(price_total), 0) AS total_ventas
        FROM sale
        WHERE date_sale = ? AND state = 'ACEPTADO'
    `;

    const sqlMovimientos = `
        SELECT 
            COALESCE(SUM(CASE WHEN operation = 'INGRESO' THEN amount ELSE 0 END), 0) AS total_ingresos,
            COALESCE(SUM(CASE WHEN operation = 'EGRESO' THEN amount ELSE 0 END), 0) AS total_egresos
        FROM entry_discharge
        WHERE date = ?
    `;

    db.query(sqlVentas, [fecha], (err, ventas) => {
        if (err) return res.status(500).json({ error: 'Error ventas', detalle: err.message });

        db.query(sqlMovimientos, [fecha], (err2, mov) => {
            if (err2) return res.status(500).json({ error: 'Error movimientos', detalle: err2.message });

            const totalVentas = parseFloat(ventas[0].total_ventas || 0);
            const totalIngresos = parseFloat(mov[0].total_ingresos || 0);
            const totalEgresos = parseFloat(mov[0].total_egresos || 0);
            const saldo = totalVentas + totalIngresos - totalEgresos;

            res.json({
                total_ventas: totalVentas.toFixed(2),
                total_ingresos: totalIngresos.toFixed(2),
                total_egresos: totalEgresos.toFixed(2),
                saldo_final: saldo.toFixed(2)
            });
        });
    });
});
	// ============================================
	// INICIAR SERVIDOR
	// ============================================
	const PORT = process.env.PORT || 3000;
	app.listen(PORT, '0.0.0.0', () => {
		console.log(`🚀 API de SisFarma corriendo en http://192.168.100.7:${PORT}`);
	});