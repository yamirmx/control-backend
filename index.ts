import express, { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'secret_para_desarrollo_temporal_123';

app.use(cors());
app.use(express.json());

// Interfaz para extender la petición con los datos del usuario autenticado
interface AuthRequest extends Request {
  user?: {
    id: number;
    email: string;
  };
}

// ==========================================
// MIDDLEWARE DE AUTENTICACIÓN
// ==========================================
const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Acceso denegado. Token no proporcionado.' });
  }

  try {
    const verified = jwt.verify(token, JWT_SECRET) as { id: number; email: string };
    req.user = verified;
    next();
  } catch (error) {
    res.status(403).json({ error: 'Token inválido o expirado.' });
  }
};

// ==========================================
// RUTAS DE AUTENTICACIÓN (AUTH)
// ==========================================

// Registro de nuevos usuarios
app.post('/api/auth/signup', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Correo y contraseña son obligatorios.' });
    }

    // Verificar si el usuario ya existe
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'El correo electrónico ya está registrado.' });
    }

    // Encriptar contraseña
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Crear usuario
    const newUser = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
      },
    });

    // Generar Token JWT de bienvenida
    const token = jwt.sign({ id: newUser.id, email: newUser.email }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      message: 'Usuario registrado con éxito',
      token,
      user: { id: newUser.id, email: newUser.email }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al registrar el usuario.' });
  }
});

// Inicio de sesión (Login)
app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Correo y contraseña son obligatorios.' });
    }

    // Buscar usuario
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(400).json({ error: 'Credenciales incorrectas.' });
    }

    // Validar contraseña
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Credenciales incorrectas.' });
    }

    // Generar Token JWT
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      message: 'Inicio de sesión exitoso',
      token,
      user: { id: user.id, email: user.email }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al iniciar sesión.' });
  }
});

// Obtener datos del perfil actual
app.get('/api/auth/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  res.json({ user: req.user });
});

// ==========================================
// RUTAS DE CUENTAS (PROTEGIDAS)
// ==========================================

// Obtener cuentas exclusivas del usuario autenticado
app.get('/api/cuentas', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const cuentas = await prisma.cuenta.findMany({
      where: { userId },
      include: {
        transacciones: {
          orderBy: { fecha: 'desc' }
        }
      }
    });
    res.json(cuentas);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener las cuentas.' });
  }
});

// Crear una nueva cuenta asignada al usuario autenticado
app.post('/api/cuentas', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { nombre, monto } = req.body;

    if (!nombre) {
      return res.status(400).json({ error: 'El nombre de la cuenta es obligatorio.' });
    }

    const nuevaCuenta = await prisma.cuenta.create({
      data: {
        nombre,
        monto: monto ? parseFloat(monto) : 0,
        userId
      }
    });

    res.status(201).json(nuevaCuenta);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al crear la cuenta.' });
  }
});

// ==========================================
// RUTAS DE TRANSACCIONES (PROTEGIDAS)
// ==========================================

// Crear transacción asociada a una cuenta del usuario
app.post('/api/transacciones', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { tipo, monto, concepto, cuentaId } = req.body;

    if (!tipo || !monto || !cuentaId) {
      return res.status(400).json({ error: 'Tipo, monto y cuentaId son obligatorios.' });
    }

    // Validar que la cuenta le pertenece al usuario autenticado
    const cuenta = await prisma.cuenta.findFirst({
      where: { id: parseInt(cuentaId), userId }
    });

    if (!cuenta) {
      return res.status(403).json({ error: 'No tienes permiso para operar en esta cuenta.' });
    }

    // Crear transacción y actualizar saldo usando una transacción de Prisma (Garantiza consistencia)
    const [nuevaTransaccion] = await prisma.$transaction([
      prisma.transaccion.create({
        data: {
          tipo,
          monto: parseFloat(monto),
          concepto,
          cuentaId: parseInt(cuentaId)
        }
      }),
      prisma.cuenta.update({
        where: { id: parseInt(cuentaId) },
        data: {
          monto: tipo === 'ingreso' 
            ? cuenta.monto + parseFloat(monto) 
            : cuenta.monto - parseFloat(monto)
        }
      })
    ]);

    res.status(201).json(nuevaTransaccion);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al registrar la transacción.' });
  }
});

// Borrar transacción y restaurar el balance de la cuenta del usuario
app.delete('/api/transacciones/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const transaccionId = parseInt(req.params.id);

    // Buscar la transacción y verificar que pertenece a una cuenta del usuario autenticado
    const transaccion = await prisma.transaccion.findUnique({
      where: { id: transaccionId },
      include: { cuenta: true }
    });

    if (!transaccion || transaccion.cuenta.userId !== userId) {
      return res.status(404).json({ error: 'Transacción no encontrada o acceso denegado.' });
    }

    // Revertir el balance en la cuenta
    const nuevoMonto = transaccion.tipo === 'ingreso'
      ? transaccion.cuenta.monto - transaccion.monto
      : transaccion.cuenta.monto + transaccion.monto;

    await prisma.$transaction([
      prisma.cuenta.update({
        where: { id: transaccion.cuentaId },
        data: { monto: nuevoMonto }
      }),
      prisma.transaccion.delete({
        where: { id: transaccionId }
      })
    ]);

    res.json({ message: 'Transacción eliminada con éxito y saldo revertido.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar la transacción.' });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor Multi-usuario activo en el puerto ${PORT}`);
});
