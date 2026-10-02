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

		// Ventas del día
		const sqlVentas = `
			SELECT s.idsale, s.serie, s.voucher_number, s.document, s.price_total, s.state,
				   CONCAT(COALESCE(c.client_name,''), ' ', COALESCE(c.client_lastname,'')) AS cliente
			FROM sale s
			LEFT JOIN client c ON s.idclient = c.idclient
			WHERE s.date_sale = ? AND s.state = 'ACEPTADO'
			ORDER BY s.idsale ASC
		`;

		// Movimientos de caja (ingreso/egreso)
		const sqlMovimientos = `
			SELECT id_entry_discharge, description, amount, type, date_entry_discharge
			FROM entry_discharge
			WHERE date_entry_discharge = ?
			ORDER BY id_entry_discharge ASC
		`;

		db.query(sqlVentas, [fecha], (err, ventas) => {
			if (err) return res.status(500).json({ error: 'Error ventas', detalle: err.message });

			db.query(sqlMovimientos, [fecha], (err2, movimientos) => {
				if (err2) {
					// Si falla (tabla diferente), devolvemos solo ventas
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
					.filter(m => (m.type || '').toUpperCase().includes('INGRESO'))
					.reduce((sum, m) => sum + parseFloat(m.amount || 0), 0);
				const totalEgresos = movimientos
					.filter(m => (m.type || '').toUpperCase().includes('EGRESO'))
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

	app.get('/api/reportes/ventas-fecha/pdf', (req, res) => {
		const { desde, hasta } = req.query;
		if (!desde || !hasta) {
			return res.status(400).json({ error: 'Faltan fechas' });
		}

		const sql = `
			SELECT 
				s.idsale, s.date_sale, s.document, s.serie, s.voucher_number,
				CONCAT(COALESCE(c.client_name,''), ' ', COALESCE(c.client_lastname,'')) AS cliente,
				u.user_name AS vendedor,
				s.subtotal, s.igv, s.price_total, s.state
			FROM sale s
			LEFT JOIN client c ON s.idclient = c.idclient
			LEFT JOIN users u ON s.iduser = u.iduser
			WHERE s.date_sale BETWEEN ? AND ? AND s.state = 'ACEPTADO'
			ORDER BY s.date_sale ASC, s.idsale ASC
		`;

		db.query(sql, [desde, hasta], (err, ventas) => {
			if (err) return res.status(500).json({ error: 'Error', detalle: err.message });

			// Calcular resumen
			const totalGeneral = ventas.reduce((sum, v) => sum + parseFloat(v.price_total || 0), 0);
			const totalSubtotal = ventas.reduce((sum, v) => sum + parseFloat(v.subtotal || 0), 0);
			const totalIva = ventas.reduce((sum, v) => sum + parseFloat(v.igv || 0), 0);

			// Crear PDF
			const doc = new PDFDocument({ size: 'A4', margin: 40 });

			// Headers para descargar
			res.setHeader('Content-Type', 'application/pdf');
			res.setHeader('Content-Disposition', `inline; filename="ventas_${desde}_${hasta}.pdf"`);

			doc.pipe(res);

			// Encabezado
			doc.fontSize(18).font('Helvetica-Bold').text('REPORTE DE VENTAS POR FECHA', { align: 'center' });
			doc.moveDown(0.5);
			doc.fontSize(10).font('Helvetica').text(`Desde: ${desde}  |  Hasta: ${hasta}`, { align: 'center' });
			doc.moveDown(1);

			// Resumen
			doc.fontSize(11).font('Helvetica-Bold').text('RESUMEN:', { underline: true });
			doc.fontSize(10).font('Helvetica');
			doc.text(`Cantidad de ventas: ${ventas.length}`);
			doc.text(`Subtotal: Bs. ${totalSubtotal.toFixed(2)}`);
			doc.text(`IVA: Bs. ${totalIva.toFixed(2)}`);
			doc.text(`TOTAL GENERAL: Bs. ${totalGeneral.toFixed(2)}`);
			doc.moveDown(1);

			// Tabla de ventas
			doc.fontSize(11).font('Helvetica-Bold').text('DETALLE:', { underline: true });
			doc.moveDown(0.5);

			const startY = doc.y;
			const cols = [
				{ label: 'Fecha', x: 40, w: 70 },
				{ label: 'Comprobante', x: 115, w: 100 },
				{ label: 'Cliente', x: 220, w: 150 },
				{ label: 'Vendedor', x: 375, w: 70 },
				{ label: 'Total', x: 450, w: 70 },
			];

			// Encabezados
			doc.fontSize(9).font('Helvetica-Bold');
			cols.forEach(col => {
				doc.text(col.label, col.x, doc.y, { width: col.w, continued: false });
			});
			doc.moveDown(0.3);
			doc.moveTo(40, doc.y).lineTo(520, doc.y).stroke();
			doc.moveDown(0.3);

			// Filas
			doc.fontSize(8).font('Helvetica');
			ventas.forEach(v => {
				if (doc.y > 750) {
					doc.addPage();
					doc.fontSize(8);
				}
				const y = doc.y;
				const fecha = (v.date_sale || '').toString().substring(0, 10);
				const comprobante = `${v.serie || ''}${v.voucher_number || ''}`;
				const cliente = (v.cliente || '').trim() || '-';
				const vendedor = v.vendedor || '-';
				const total = `Bs. ${parseFloat(v.price_total || 0).toFixed(2)}`;

				doc.text(fecha, 40, y, { width: 70 });
				doc.text(comprobante, 115, y, { width: 100 });
				doc.text(cliente.substring(0, 30), 220, y, { width: 150 });
				doc.text(vendedor, 375, y, { width: 70 });
				doc.text(total, 450, y, { width: 70 });
				doc.moveDown(0.3);
			});

			// Pie de página
			doc.moveDown(1);
			doc.fontSize(8).font('Helvetica').text(`Generado el ${new Date().toLocaleString('es-BO')}`, { align: 'center' });
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
				b.purchase_price, b.sale_price, b.sale_price_b, b.sale_price_c
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
			cant_blister, cant_box, stock_min
		} = req.body;

		const sql = `
			UPDATE batch SET
				batch_number = ?, expiration_date = ?, batch_stock = ?,
				purchase_price = ?, sale_price = ?, sale_price_b = ?, sale_price_c = ?,
				cant_blister = ?, cant_box = ?, stock_min = ?
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
			cant_blister, cant_box, stock_min
		} = req.body;

		const sql = `
			INSERT INTO batch (idproduct, batch_number, expiration_date, batch_stock,
				purchase_price, sale_price, sale_price_b, sale_price_c,
				cant_blister, cant_box, stock_min)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
			stock_min || 0
		], (err, result) => {
			if (err) {
				console.error('Error al agregar lote:', err);
				return res.status(500).json({ error: 'Error en el servidor', detalle: err.message });
			}
			res.json({ mensaje: 'Lote agregado', idbatch: result.insertId });
		});
	});


	// ============================================
	// INICIAR SERVIDOR
	// ============================================
	const PORT = process.env.PORT || 3000;
	app.listen(PORT, '0.0.0.0', () => {
		console.log(`🚀 API de SisFarma corriendo en http://192.168.100.7:${PORT}`);
	});