import express, { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

const prisma = new PrismaClient();
const app = express();

app.use(cors()); 
app.use(express.json());

// --- 1. CONFIGURACIÓN DE SEGURIDAD (Rate Limiter) ---
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // Límite de 5 peticiones por IP
  message: {
    error: 'Demasiados intentos de inicio de sesión. Por favor, inténtalo de nuevo en 15 minutos.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Aplicar a rutas críticas
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/signup', authLimiter);

// --- 2. RUTAS DE CUENTAS Y DASHBOARD ---

// Cargar Dashboard (Paginación inicial de 10)
app.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const cuentas = await prisma.cuenta.findMany({
      orderBy: { nombre: 'asc' },
      include: { 
        transacciones: { 
          orderBy: { fecha: 'desc' },
          take: 10 
        } 
      }
    });
    res.json(cuentas);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/cuentas', async (req: Request, res: Response) => {
  try {
    const cuentas = await prisma.cuenta.findMany({
      orderBy: { nombre: 'asc' },
      include: { 
        transacciones: { orderBy: { fecha: 'desc' }, take: 10 } 
      }
    });
    res.json(cuentas);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Cargar más transacciones (Paginación)
app.get('/api/cuentas/:id/transacciones', async (req: Request, res: Response) => {
  const { id } = req.params;
  const skip = Number(req.query.skip) || 0; 
  const take = 10; 

  try {
    const nuevasTransacciones = await prisma.transaccion.findMany({
      where: { cuentaId: Number(id) },
      orderBy: { fecha: 'desc' },
      skip: skip,
      take: take
    });
    res.json(nuevasTransacciones);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Crear Cuenta
app.post('/cuentas', async (req: Request, res: Response) => {
  const { nombre, monto } = req.body;
  try {
    const nuevaCuenta = await prisma.cuenta.create({
      data: { nombre, monto: Number(monto) }
    });
    res.status(201).json(nuevaCuenta);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Editar nombre de cuenta
app.put('/cuentas/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { nombre } = req.body;
  try {
    const editado = await prisma.cuenta.update({ where: { id: Number(id) }, data: { nombre } });
    res.json(editado);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar Cuenta y sus transacciones
app.delete('/cuentas/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.transaccion.deleteMany({ where: { cuentaId: Number(id) } });
    await prisma.cuenta.delete({ where: { id: Number(id) } });
    res.json({ message: "Eliminado" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- 3. RUTAS DE MOVIMIENTOS Y TRANSACCIONES ---

// Registrar Movimiento (Actualiza saldo de cuenta automáticamente)
app.post('/movimientos', async (req: Request, res: Response): Promise<any> => {
  const { cuentaId, tipo, monto, concepto, fecha } = req.body; 
  const valor = Number(monto);

  try {
    const cuenta = await prisma.cuenta.findUnique({ where: { id: Number(cuentaId) } });
    if (!cuenta) return res.status(404).json({ error: "Cuenta no encontrada" });

    let nuevoSaldo = cuenta.monto;
    
    const aumenta = ["Préstamo", "Gasto", "Pago de servicio"].includes(tipo);
    const disminuye = ["Ingreso", "Abono", "Adelanto", "Pago de nómina"].includes(tipo);

    if (aumenta) {
      nuevoSaldo += valor;
    } else if (disminuye) {
      nuevoSaldo -= valor;
    }

    const datosTransaccion: any = { tipo, monto: valor, cuentaId: Number(cuentaId) };
    if (concepto) datosTransaccion.concepto = concepto;
    if (fecha) datosTransaccion.fecha = new Date(fecha); 

    const resultado = await prisma.$transaction([
      prisma.transaccion.create({ data: datosTransaccion }),
      prisma.cuenta.update({
        where: { id: Number(cuentaId) },
        data: { monto: nuevoSaldo }
      })
    ]);

    res.json(resultado);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Historial completo para exportación (PDF/CSV)
app.get('/cuentas/:id/historial', async (req: Request, res: Response): Promise<any> => {
  const { id } = req.params;
  try {
    const cuenta = await prisma.cuenta.findUnique({
      where: { id: Number(id) },
      include: { transacciones: { orderBy: { fecha: 'desc' } } } 
    });
    if (!cuenta) return res.status(404).json({ error: "No encontrado" });
    res.json(cuenta);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- 4. RUTAS DE PRESUPUESTOS ---

app.get('/presupuestos/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;
  try {
    const presupuestos = await prisma.presupuesto.findMany({
      where: { userId: Number(userId) },
      orderBy: { categoria: 'asc' }
    });
    res.json(presupuestos);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/presupuestos', async (req: Request, res: Response) => {
  const { categoria, montoMax, userId } = req.body;
  try {
    const nuevoPresupuesto = await prisma.presupuesto.create({
      data: { 
        categoria, 
        montoMax: Number(montoMax), 
        userId: Number(userId) 
      }
    });
    res.status(201).json(nuevoPresupuesto);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- 5. RUTAS DE METAS DE AHORRO ---

app.get('/metas/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;
  try {
    const metas = await prisma.metaAhorro.findMany({
      where: { userId: Number(userId) },
      orderBy: { fechaLimite: 'asc' }
    });
    res.json(metas);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/metas', async (req: Request, res: Response) => {
  const { nombre, montoMeta, montoActual, fechaLimite, userId } = req.body;
  try {
    const nuevaMeta = await prisma.metaAhorro.create({
      data: {
        nombre,
        montoMeta: Number(montoMeta),
        montoActual: Number(montoActual || 0),
        fechaLimite: fechaLimite ? new Date(fechaLimite) : null,
        userId: Number(userId)
      }
    });
    res.status(201).json(nuevaMeta);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// --- 6. INICIO DEL SERVIDOR ---
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Backend corriendo en el puerto ${PORT}`));
